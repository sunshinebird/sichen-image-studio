"""Local CPU image analysis. Coordinates on the wire are normalized to the original."""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(2)

def decoded(path):
    image = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if image is None or image.shape[0] * image.shape[1] > 18_000_000:
        raise ValueError("Image cannot be decoded")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    return image

def opaque(image):
    if image.shape[2] == 3:
        return image
    weight = image[:, :, 3:4].astype(np.float32) / 255
    return (image[:, :, :3] * weight + 255 * (1 - weight)).astype(np.uint8)

def resize_long(image, edge):
    h, w = image.shape[:2]
    if max(w, h) <= edge:
        return image
    scale = edge / max(w, h)
    return cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)

def box(x, y, w, h, width, height):
    return {"x": x / width, "y": y / height, "width": w / width, "height": h / height}

def scan_text(image):
    from rapidocr import RapidOCR

    engine = RapidOCR(params={
        "EngineConfig.onnxruntime.intra_op_num_threads": 2,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })
    scan = resize_long(opaque(image), 1800)
    h, w = scan.shape[:2]
    result = engine(scan, use_cls=False, text_score=0.55)
    lines = []
    quadrilaterals = [] if result.boxes is None else result.boxes
    for text, score, coordinates in zip(result.txts or (), result.scores or (), quadrilaterals):
        quad = np.clip(coordinates / (w, h), 0, 1)
        left, top = quad.min(0)
        right, bottom = quad.max(0)
        if right <= left or bottom <= top:
            continue
        lines.append({
            "text": text[:84], "score": round(float(score), 3), "quad": quad.tolist(),
            "box": {"x": left, "y": top, "width": right - left, "height": bottom - top},
        })
    lines.sort(key=lambda item: (item["box"]["y"], item["box"]["x"]))
    return {"lines": lines[:24]}

def text_patch(original, line, directory):
    h, w = original.shape[:2]
    polygon = np.round(np.asarray(line["quad"]) * (w, h)).astype(np.int32)
    x, y, bw, bh = cv2.boundingRect(polygon)
    padding = min(60, max(12, round(min(bw, bh) * 0.12)))
    x0, y0 = max(0, x - padding), max(0, y - padding)
    x1, y1 = min(w, x + bw + padding), min(h, y + bh + padding)
    # Process a bounded neighborhood and copy only pixels under the ink mask.
    roi = original[y0:y1, x0:x1, :3].copy()
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    area = np.zeros(gray.shape, np.uint8)
    cv2.fillConvexPoly(area, polygon - (x0, y0), 255)
    inside = gray[area > 0]
    if inside.size < 40:
        return {"unusable": True}
    outside = gray[area == 0]
    background = float(np.median(outside if outside.size >= 100 else inside))
    threshold, _ = cv2.threshold(inside, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright = background < threshold
    ink = ((gray > threshold) if bright else (gray <= threshold)) & (area > 0)
    if ink.sum() < 20 or ink.sum() > inside.size * 0.67:
        return {"unusable": True}
    count, labels, regions, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    allowed = np.zeros(count, np.uint8)
    allowed[1:] = (regions[1:, cv2.CC_STAT_AREA] >= max(5, round(inside.size * 0.00012))) * 255
    ink = allowed[labels]
    if not np.any(ink):
        return {"unusable": True}
    ix, iy, iw, ih = cv2.boundingRect(ink)
    color = np.median(roi[ink > 0], 0).astype(int)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.dilate(ink, kernel)
    repaired = cv2.inpaint(roi, mask, 6, cv2.INPAINT_TELEA)
    output = original.copy()
    output[y0:y1, x0:x1, :3] = repaired
    if not cv2.imwrite(str(directory / "background.png"), output):
        raise ValueError("Cannot save repaired image")
    return {
        "box": box(ix+x0, iy+y0, iw, ih, w, h),
        "fill": "#%02x%02x%02x" % tuple(color[::-1]),
        "angle": round(math.degrees(math.atan2(*(polygon[1] - polygon[0])[::-1])), 1),
    }

def components_at_points(logits, points):
    h, w = logits.shape
    _, labels = cv2.connectedComponents((logits > 0).astype(np.uint8), connectivity=8)
    keep = set()
    remove = set()
    for p in points:
        x, y = min(w - 1, round(p["x"] * w)), min(h - 1, round(p["y"] * h))
        label = labels[y, x]
        if label:
            (keep if p["include"] else remove).add(label)
    result = np.isin(labels, list(keep - remove)).astype(np.uint8)
    if not result.any():
        return result.astype(bool)
    # Seal minor holes without filling large openings such as bag handles.
    count, background_labels, stats, _ = cv2.connectedComponentsWithStats(1 - result, connectivity=8)
    repair = np.zeros(count, np.uint8)
    size = result.sum()
    for index in range(1, count):
        x, y, bw, bh, area = stats[index]
        if x > 0 and y > 0 and x + bw < w and y + bh < h and area < size * 0.035:
            repair[index] = 1
    return (result | repair[background_labels]).astype(bool)

def subject_masks(original, points, models, directory):
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 3
    options.inter_op_num_threads = 1
    providers = ["CPUExecutionProvider"]
    encoder = ort.InferenceSession(str(models / "vision_encoder_quantized.onnx"), options, providers=providers)
    decoder = ort.InferenceSession(str(models / "prompt_encoder_mask_decoder_quantized.onnx"), options, providers=providers)

    h, w = original.shape[:2]
    rw, rh = [max(1, round(v * 1024 / max(w, h))) for v in (w, h)]
    rgb = cv2.cvtColor(opaque(original), cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (rw, rh), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    pixels = np.zeros((1024, 1024, 3), np.float32)
    mean = np.array([0.485, 0.456, 0.406], np.float32)
    std = np.array([0.229, 0.224, 0.225], np.float32)
    pixels[:rh, :rw] = (resized - mean) / std
    embedding, positional = encoder.run(None, {"pixel_values": np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])})
    coordinates = np.array([[[[p["x"]*rw, p["y"]*rh] for p in points]]], np.float32)
    labels = np.array([[[int(p["include"]) for p in points]]], np.int64)
    scores, masks = decoder.run(None, {
        "input_points": coordinates, "input_labels": labels,
        "image_embeddings": embedding, "image_positional_embeddings": positional,
    })
    candidates = []
    previous = []
    for rank, index in enumerate(np.argsort(scores.reshape(-1))[::-1]):
        score = float(scores.reshape(-1)[index])
        logits = cv2.resize(cv2.resize(masks.reshape(-1, 256, 256)[index], (1024,1024))[:rh, :rw], (w,h))
        binary = components_at_points(logits, points)
        fraction = float(binary.mean())
        if score < 0.43 or not 0.0003 < fraction < 0.83:
            continue
        if any(np.logical_and(binary, other).sum() / np.logical_or(binary, other).sum() > 0.95 for other in previous):
            continue
        # Restrict the soft edge to the connected selection. Disconnected specks
        # otherwise create an oversized bounding box when the layer is moved.
        alpha = cv2.GaussianBlur(binary.astype(np.uint8) * 255, (5, 5), 0.75)
        alpha[alpha < 8] = 0
        if original.shape[2] == 4:
            alpha = np.minimum(alpha, original[:, :, 3])
        x, y, bw, bh = cv2.boundingRect(alpha)
        if bw < 4 or bh < 4:
            continue
        name = "mask-%d.png" % rank
        if not cv2.imwrite(str(directory / name), alpha):
            raise ValueError("Cannot save selection")
        candidates.append({"file": name, "score": round(score, 3), "box": box(x, y, bw, bh, w, h), "area": round(fraction, 4)})
        previous.append(binary)
    return {"candidates": candidates}

def fill_subject(original, models, directory):
    import onnxruntime as ort

    mask = cv2.imread(str(directory / "selection.png"), cv2.IMREAD_GRAYSCALE)
    if mask is None or mask.shape != original.shape[:2]:
        raise ValueError("Incorrect mask dimensions")
    mask = ((mask > 16) * 255).astype(np.uint8)
    if np.count_nonzero(mask) > mask.size * 0.36:
        return {"unusable": True}
    h, w = mask.shape
    spread = min(11, max(5, round(max(w, h) * 0.005)))
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (spread * 2 + 1, spread * 2 + 1)))
    x, y, bw, bh = cv2.boundingRect(mask)
    if bw < 5 or bh < 5:
        return {"unusable": True}
    edge = min(max(w, h), math.ceil(max(bw, bh) * 1.35))
    crop_w, crop_h = min(edge, w), min(edge, h)
    x0 = max(0, min(w - crop_w, x + (bw - crop_w) // 2))
    y0 = max(0, min(h - crop_h, y + (bh - crop_h) // 2))
    rows, cols = slice(y0, y0 + crop_h), slice(x0, x0 + crop_w)
    source = original[rows, cols, :3]
    target = mask[rows, cols]
    padded_source = cv2.copyMakeBorder(source, 0, edge - crop_h, 0, edge - crop_w, cv2.BORDER_REFLECT_101)
    padded_mask = cv2.copyMakeBorder(target, 0, edge - crop_h, 0, edge - crop_w, cv2.BORDER_REFLECT_101)
    image = cv2.resize(padded_source, (512, 512), interpolation=cv2.INTER_AREA)
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    model_mask = cv2.resize(padded_mask, (512, 512), interpolation=cv2.INTER_NEAREST).astype(np.float32) / 255

    options = ort.SessionOptions()
    options.intra_op_num_threads = 3
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(models / "lama_fp16.onnx"), options, providers=["CPUExecutionProvider"])
    result = session.run(None, {"image": np.ascontiguousarray(image.transpose(2, 0, 1)[None]), "mask": model_mask[None, None]})[0]
    if not np.isfinite(result).all():
        return {"unusable": True}
    fill = np.clip(result[0].transpose(1, 2, 0)[:, :, ::-1], 0, 255).astype(np.uint8)
    fill = cv2.resize(fill, (edge, edge), interpolation=cv2.INTER_CUBIC)[:crop_h, :crop_w]
    blend = cv2.GaussianBlur(target, (5, 5), 0.9)[:, :, None].astype(np.float32) / 255
    output = original.copy()
    output[rows, cols, :3] = np.round(fill * blend + source * (1 - blend)).astype(np.uint8)
    if not cv2.imwrite(str(directory / "background.png"), output):
        raise ValueError("Cannot save repaired image")
    return {"unusable": False}

def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    directory = Path(sys.argv[1]).parent
    image = decoded(request["path"])
    operation = request["operation"]
    if operation == "scan":
        result = scan_text(image)
    elif operation == "text":
        result = text_patch(image, request["line"], directory)
    elif operation == "subject":
        result = subject_masks(image, request["points"], Path(request["models"]), directory)
    elif operation == "fill":
        result = fill_subject(image, Path(request["models"]), directory)
    else:
        raise ValueError("Unknown operation")
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))

if __name__ == "__main__":
    main()
