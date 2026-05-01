"use strict";

const state = {
  pages: [],
  stream: null,
  deferredInstall: null,
  guideFrame: 0,
  guideQuad: null,
  guideLastRun: 0,
  guideLastSeen: 0
};

const els = {
  video: document.querySelector("#cameraPreview"),
  canvas: document.querySelector("#workingCanvas"),
  documentGuide: document.querySelector("#documentGuide"),
  empty: document.querySelector("#emptyState"),
  cameraButton: document.querySelector("#cameraButton"),
  snapButton: document.querySelector("#snapButton"),
  dockSnapButton: document.querySelector("#dockSnapButton"),
  dockCloseButton: document.querySelector("#dockCloseButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  cameraOverlay: document.querySelector("#cameraOverlay"),
  cameraDock: document.querySelector("#cameraDock"),
  cameraInput: document.querySelector("#cameraInput"),
  fileInput: document.querySelector("#fileInput"),
  statusText: document.querySelector("#statusText"),
  modeSelect: document.querySelector("#modeSelect"),
  paperSelect: document.querySelector("#paperSelect"),
  autoCropInput: document.querySelector("#autoCropInput"),
  pageList: document.querySelector("#pageList"),
  pageCount: document.querySelector("#pageCount"),
  pageTemplate: document.querySelector("#pageTemplate"),
  saveJpgButton: document.querySelector("#saveJpgButton"),
  savePdfButton: document.querySelector("#savePdfButton"),
  clearButton: document.querySelector("#clearButton"),
  installButton: document.querySelector("#installButton")
};

const MAX_OUTPUT_EDGE = 2200;

init();

function init() {
  bindEvents();
  renderPages();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function bindEvents() {
  els.cameraButton.addEventListener("click", startCamera);
  els.snapButton.addEventListener("click", captureFromCamera);
  els.dockSnapButton.addEventListener("click", captureFromCamera);
  els.dockCloseButton.addEventListener("click", stopCamera);
  els.stopCameraButton.addEventListener("click", stopCamera);
  els.cameraInput.addEventListener("change", handleCameraInput);
  els.fileInput.addEventListener("change", handleFileInput);
  els.modeSelect.addEventListener("change", reprocessAllPages);
  els.autoCropInput.addEventListener("change", reprocessAllPages);
  els.saveJpgButton.addEventListener("click", saveJpgPages);
  els.savePdfButton.addEventListener("click", savePdf);
  els.clearButton.addEventListener("click", clearPages);
  els.pageList.addEventListener("click", handlePageAction);
  els.installButton.addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstall = event;
    els.installButton.hidden = false;
  });
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Live preview needs HTTPS or localhost. Opening the phone camera instead.");
    els.cameraInput.click();
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    els.video.hidden = false;
    els.empty.hidden = true;
    els.cameraOverlay.hidden = false;
    els.documentGuide.hidden = false;
    els.cameraDock.hidden = false;
    els.cameraButton.hidden = true;
    els.stopCameraButton.hidden = false;
    startDocumentGuide();
  } catch (error) {
    setStatus(cameraErrorMessage(error));
    els.cameraInput.click();
  }
}

function stopCamera() {
  stopDocumentGuide();
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }
  state.stream = null;
  els.video.srcObject = null;
  els.video.hidden = true;
  els.cameraOverlay.hidden = true;
  els.documentGuide.hidden = true;
  els.cameraDock.hidden = true;
  els.cameraButton.hidden = false;
  els.stopCameraButton.hidden = true;
  updatePreviewVisibility();
}

function startDocumentGuide() {
  stopDocumentGuide();

  const draw = () => {
    if (!state.stream || els.video.hidden) return;
    drawDocumentGuide();
    state.guideFrame = requestAnimationFrame(draw);
  };

  draw();
}

function stopDocumentGuide() {
  if (state.guideFrame) {
    cancelAnimationFrame(state.guideFrame);
  }
  state.guideFrame = 0;
  state.guideQuad = null;
  state.guideLastRun = 0;
  state.guideLastSeen = 0;
  const ctx = els.documentGuide.getContext("2d");
  ctx.clearRect(0, 0, els.documentGuide.width, els.documentGuide.height);
}

function drawDocumentGuide() {
  const display = els.video.getBoundingClientRect();
  const width = Math.max(1, Math.round(display.width * devicePixelRatio));
  const height = Math.max(1, Math.round(display.height * devicePixelRatio));
  if (els.documentGuide.width !== width || els.documentGuide.height !== height) {
    els.documentGuide.width = width;
    els.documentGuide.height = height;
  }

  const ctx = els.documentGuide.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  if (!els.video.videoWidth || !els.video.videoHeight) return;
  const now = performance.now();

  if (now - state.guideLastRun > 420) {
    state.guideLastRun = now;
    const frame = document.createElement("canvas");
    frame.width = els.video.videoWidth;
    frame.height = els.video.videoHeight;
    frame.getContext("2d").drawImage(els.video, 0, 0);
    const quad = detectDocumentQuad(frame);

    if (quad) {
      state.guideQuad = smoothQuad(state.guideQuad, quad, 0.35);
      state.guideLastSeen = now;
    }
  }

  if (!state.guideQuad || now - state.guideLastSeen > 1600) {
    state.guideQuad = null;
    drawGuideHint(ctx, width, height);
    return;
  }

  const quad = state.guideQuad;
  const points = quad.map((point) => mapVideoPointToDisplay(point, width, height));
  ctx.lineWidth = Math.max(3, Math.round(4 * devicePixelRatio));
  ctx.strokeStyle = "#22c55e";
  ctx.fillStyle = "rgba(34, 197, 94, 0.12)";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(7, 9 * devicePixelRatio), 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(2, Math.round(2 * devicePixelRatio));
    ctx.strokeStyle = "#16a34a";
    ctx.stroke();
  }
}

function smoothQuad(previous, next, amount) {
  if (!previous) return next;
  return next.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * amount,
    y: previous[index].y + (point.y - previous[index].y) * amount
  }));
}

function drawGuideHint(ctx, width, height) {
  const marginX = width * 0.14;
  const marginY = height * 0.16;
  ctx.lineWidth = Math.max(2, Math.round(2 * devicePixelRatio));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.62)";
  ctx.setLineDash([14 * devicePixelRatio, 10 * devicePixelRatio]);
  ctx.strokeRect(marginX, marginY, width - marginX * 2, height - marginY * 2);
  ctx.setLineDash([]);
}

function mapVideoPointToDisplay(point, displayWidth, displayHeight) {
  const videoRatio = els.video.videoWidth / els.video.videoHeight;
  const displayRatio = displayWidth / displayHeight;
  let drawnWidth = displayWidth;
  let drawnHeight = displayHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (displayRatio > videoRatio) {
    drawnWidth = displayHeight * videoRatio;
    offsetX = (displayWidth - drawnWidth) / 2;
  } else {
    drawnHeight = displayWidth / videoRatio;
    offsetY = (displayHeight - drawnHeight) / 2;
  }

  return {
    x: offsetX + (point.x / els.video.videoWidth) * drawnWidth,
    y: offsetY + (point.y / els.video.videoHeight) * drawnHeight
  };
}

async function captureFromCamera() {
  if (!els.video.videoWidth || !els.video.videoHeight) return;
  const source = document.createElement("canvas");
  source.width = els.video.videoWidth;
  source.height = els.video.videoHeight;
  source.getContext("2d").drawImage(els.video, 0, 0);
  await addImageCanvas(source);
}

async function handleCameraInput(event) {
  const file = event.target.files?.[0];
  if (file?.type.startsWith("image/")) {
    await addImageFile(file);
  }
  event.target.value = "";
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      await addImageFile(file);
    }
  }
  event.target.value = "";
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "Camera permission was blocked. Allow camera access or use the phone camera capture.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No live camera was found. Opening the phone camera capture.";
  }

  if (!window.isSecureContext) {
    return "Live preview needs HTTPS or localhost. Opening the phone camera instead.";
  }

  return "Live camera preview is unavailable. Opening the phone camera capture.";
}

async function addImageFile(file) {
  const image = await loadImage(URL.createObjectURL(file));
  const source = document.createElement("canvas");
  const { width, height } = scaledSize(image.naturalWidth, image.naturalHeight, MAX_OUTPUT_EDGE);
  source.width = width;
  source.height = height;
  source.getContext("2d").drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);
  await addImageCanvas(source);
}

async function addImageCanvas(source) {
  const originalDataUrl = source.toDataURL("image/jpeg", 0.94);
  const processed = processCanvas(source);
  state.pages.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    originalDataUrl,
    processedDataUrl: processed.canvas.toDataURL("image/jpeg", 0.92),
    width: processed.canvas.width,
    height: processed.canvas.height
  });
  drawPreview(processed.canvas);
  renderPages();
}

async function reprocessAllPages() {
  for (const page of state.pages) {
    const image = await loadImage(page.originalDataUrl);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    source.getContext("2d").drawImage(image, 0, 0);
    const processed = processCanvas(source);
    page.processedDataUrl = processed.canvas.toDataURL("image/jpeg", 0.92);
    page.width = processed.canvas.width;
    page.height = processed.canvas.height;
  }

  if (state.pages.length) {
    const image = await loadImage(state.pages[state.pages.length - 1].processedDataUrl);
    drawImageToPreview(image);
  }
  renderPages();
}

function processCanvas(source) {
  let canvas = document.createElement("canvas");
  const quad = els.autoCropInput.checked ? detectDocumentQuad(source) : null;

  if (quad) {
    canvas = warpDocument(source, quad);
  } else {
    const crop = els.autoCropInput.checked ? detectDocumentBounds(source) : null;
    const src = crop || { x: 0, y: 0, width: source.width, height: source.height };
    const size = scaledSize(src.width, src.height, MAX_OUTPUT_EDGE);
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(source, src.x, src.y, src.width, src.height, 0, 0, canvas.width, canvas.height);
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  applyScanFilter(ctx, canvas.width, canvas.height, els.modeSelect.value);
  return { canvas };
}

function detectDocumentQuad(canvas) {
  const sampleEdge = 620;
  const scale = Math.min(1, sampleEdge / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const width = sample.width;
  const height = sample.height;
  const luminance = new Float32Array(width * height);
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luminance[i / 4] = value;
    total += value;
  }

  const mean = total / luminance.length;
  const borderMean = estimateBorderMean(luminance, width, height);
  const mask = createDocumentMask(luminance, width, height, mean, borderMean);
  closeMask(mask, width, height, 3);
  const component = findBestDocumentComponent(mask, width, height);
  if (!component?.corners) return null;

  const quad = orderQuad(component.corners).map((point) => ({
    x: Math.round(point.x / scale),
    y: Math.round(point.y / scale)
  }));

  if (!isUsableQuad(quad, canvas.width, canvas.height)) return null;
  return quad;
}

function createDocumentMask(luminance, width, height, mean, borderMean) {
  const mask = new Uint8Array(width * height);
  const lightThreshold = Math.min(238, Math.max(132, mean + 12, borderMean + 24));

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const gx = Math.abs(luminance[index + 1] - luminance[index - 1]);
      const gy = Math.abs(luminance[index + width] - luminance[index - width]);
      const contrast = Math.max(gx, gy);
      const brightPage = luminance[index] > lightThreshold && luminance[index] > borderMean + 20;
      const flatPage = contrast < 40 && luminance[index] > Math.max(170, mean + 4) && luminance[index] > borderMean + 10;
      if (brightPage || flatPage) mask[index] = 1;
    }
  }

  return mask;
}

function warpDocument(source, quad) {
  const [tl, tr, br, bl] = quad;
  const targetWidth = Math.round(Math.max(distance(tl, tr), distance(bl, br)));
  const targetHeight = Math.round(Math.max(distance(tl, bl), distance(tr, br)));
  const size = scaledSize(targetWidth, targetHeight, MAX_OUTPUT_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const output = ctx.createImageData(canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    const v = canvas.height === 1 ? 0 : y / (canvas.height - 1);
    for (let x = 0; x < canvas.width; x++) {
      const u = canvas.width === 1 ? 0 : x / (canvas.width - 1);
      const top = interpolatePoint(tl, tr, u);
      const bottom = interpolatePoint(bl, br, u);
      const src = interpolatePoint(top, bottom, v);
      sampleBilinear(sourceData, source.width, source.height, src.x, src.y, output.data, (y * canvas.width + x) * 4);
    }
  }

  ctx.putImageData(output, 0, 0);
  return canvas;
}

function interpolatePoint(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount
  };
}

function sampleBilinear(imageData, width, height, x, y, target, targetIndex) {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const data = imageData.data;

  for (let channel = 0; channel < 4; channel++) {
    const a = data[(y0 * width + x0) * 4 + channel];
    const b = data[(y0 * width + x1) * 4 + channel];
    const c = data[(y1 * width + x0) * 4 + channel];
    const d = data[(y1 * width + x1) * 4 + channel];
    target[targetIndex + channel] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isUsableQuad(quad, width, height) {
  const area = polygonArea(quad);
  const coverage = area / (width * height);
  const minSide = Math.min(distance(quad[0], quad[1]), distance(quad[1], quad[2]), distance(quad[2], quad[3]), distance(quad[3], quad[0]));
  return coverage > 0.08 && coverage < 0.94 && minSide > Math.min(width, height) * 0.18;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area / 2);
}

function orderQuad(points) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  const sorted = points.slice().sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const topIndex = sorted.reduce((best, point, index) => point.x + point.y < sorted[best].x + sorted[best].y ? index : best, 0);
  return [...sorted.slice(topIndex), ...sorted.slice(0, topIndex)];
}

function detectDocumentBounds(canvas) {
  const sampleEdge = 620;
  const scale = Math.min(1, sampleEdge / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const width = sample.width;
  const height = sample.height;
  const luminance = new Float32Array(width * height);
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luminance[i / 4] = value;
    total += value;
  }

  const mean = total / luminance.length;
  const mask = new Uint8Array(width * height);
  const borderMean = estimateBorderMean(luminance, width, height);
  const lightThreshold = Math.min(235, Math.max(115, mean + 10, borderMean + 22));

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const gx = Math.abs(luminance[index + 1] - luminance[index - 1]);
      const gy = Math.abs(luminance[index + width] - luminance[index - width]);
      const localContrast = Math.max(gx, gy);
      const isPageLight = luminance[index] > lightThreshold && luminance[index] > borderMean + 18;
      const isInsideEdge = localContrast < 58 && luminance[index] > mean - 20;

      if (isPageLight || (isInsideEdge && luminance[index] > 150)) {
        mask[index] = 1;
      }
    }
  }

  closeMask(mask, width, height, 2);
  const component = findBestDocumentComponent(mask, width, height);
  if (!component) {
    return detectFallbackBounds(luminance, width, height, scale);
  }

  return boundsToSource(component, width, height, scale);
}

function estimateBorderMean(luminance, width, height) {
  const band = Math.max(4, Math.round(Math.min(width, height) * 0.06));
  let total = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < band || y < band || x >= width - band || y >= height - band) {
        total += luminance[y * width + x];
        count++;
      }
    }
  }

  return total / count;
}

function closeMask(mask, width, height, radius) {
  const dilated = new Uint8Array(mask.length);
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (mask[(y + dy) * width + x + dx]) {
            found = true;
            break;
          }
        }
      }
      if (found) dilated[y * width + x] = 1;
    }
  }

  mask.set(dilated);
}

function findBestDocumentComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const minArea = width * height * 0.08;
  let best = null;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let tl = { x: 0, y: 0, score: Infinity };
    let tr = { x: 0, y: 0, score: -Infinity };
    let br = { x: 0, y: 0, score: -Infinity };
    let bl = { x: 0, y: 0, score: Infinity };

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.score) tl = { x, y, score: sum };
      if (diff > tr.score) tr = { x, y, score: diff };
      if (sum > br.score) br = { x, y, score: sum };
      if (diff < bl.score) bl = { x, y, score: diff };

      addNeighbor(index - 1, x > 0);
      addNeighbor(index + 1, x < width - 1);
      addNeighbor(index - width, y > 0);
      addNeighbor(index + width, y < height - 1);
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const boxArea = boxWidth * boxHeight;
    const fill = area / boxArea;
    const coverage = boxArea / (width * height);
    const touchesManyEdges = Number(minX < 3) + Number(minY < 3) + Number(maxX > width - 4) + Number(maxY > height - 4);

    if (area >= minArea && fill > 0.42 && coverage > 0.12 && coverage < 0.86 && touchesManyEdges < 2) {
      const score = area * fill * (1 - Math.abs(0.46 - coverage));
      if (!best || score > best.score) {
        best = {
          minX,
          minY,
          maxX,
          maxY,
          score,
          corners: [
            { x: tl.x, y: tl.y },
            { x: tr.x, y: tr.y },
            { x: br.x, y: br.y },
            { x: bl.x, y: bl.y }
          ]
        };
      }
    }

    function addNeighbor(next, inBounds) {
      if (inBounds && mask[next] && !visited[next]) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  return best;
}

function detectFallbackBounds(luminance, width, height, scale) {
  const edge = new Uint8Array(width * height);
  let edgeTotal = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const gx = Math.abs(luminance[index + 1] - luminance[index - 1]);
      const gy = Math.abs(luminance[index + width] - luminance[index - width]);
      const value = gx + gy;
      if (value > 42) {
        edge[index] = 1;
        edgeTotal++;
      }
    }
  }

  if (edgeTotal < width * height * 0.015) return null;

  const columns = projectionBounds(edge, width, height, "x");
  const rows = projectionBounds(edge, width, height, "y");
  if (!columns || !rows) return null;

  const component = {
    minX: columns.min,
    maxX: columns.max,
    minY: rows.min,
    maxY: rows.max
  };
  return boundsToSource(component, width, height, scale);
}

function projectionBounds(edge, width, height, axis) {
  const size = axis === "x" ? width : height;
  const limit = axis === "x" ? height : width;
  const counts = new Uint16Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edge[y * width + x]) {
        counts[axis === "x" ? x : y]++;
      }
    }
  }

  const threshold = Math.max(3, Math.round(limit * 0.025));
  let min = 0;
  let max = size - 1;

  while (min < size && counts[min] < threshold) min++;
  while (max > min && counts[max] < threshold) max--;

  if (max - min < size * 0.28 || max - min > size * 0.96) return null;
  return { min, max };
}

function boundsToSource(bounds, width, height, scale) {
  const pad = Math.round(Math.min(width, height) * 0.018);
  const minX = Math.max(0, bounds.minX - pad);
  const minY = Math.max(0, bounds.minY - pad);
  const maxX = Math.min(width - 1, bounds.maxX + pad);
  const maxY = Math.min(height - 1, bounds.maxY + pad);

  if (maxX - minX < width * 0.28 || maxY - minY < height * 0.28) {
    return null;
  }

  return {
    x: Math.round(minX / scale),
    y: Math.round(minY / scale),
    width: Math.round((maxX - minX + 1) / scale),
    height: Math.round((maxY - minY + 1) / scale)
  };
}

function applyScanFilter(ctx, width, height, mode) {
  if (mode === "original") return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const grayscale = mode === "document" || mode === "grayscale";
  const contrast = mode === "document" ? 1.22 : mode === "color" ? 1.12 : 1.12;
  const brightness = mode === "document" ? 7 : mode === "color" ? 4 : 2;
  const levels = grayscale ? getGrayLevels(data) : null;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const normalized = normalizeLevel(gray, levels.black, levels.white);
      const leveled = mode === "document" ? gray * 0.32 + normalized * 0.68 : gray * 0.55 + normalized * 0.45;
      r = leveled;
      g = leveled;
      b = leveled;
    }

    data[i] = clamp((r - 128) * contrast + 128 + brightness);
    data[i + 1] = clamp((g - 128) * contrast + 128 + brightness);
    data[i + 2] = clamp((b - 128) * contrast + 128 + brightness);

    if (mode === "document") {
      const v = data[i];
      const paperLift = v > 174 ? Math.min(248, v + (248 - v) * 0.55) : v;
      const inkWeight = paperLift < 92 ? Math.max(18, paperLift * 0.78) : paperLift;
      const scanned = clamp(inkWeight);
      data[i] = scanned;
      data[i + 1] = scanned;
      data[i + 2] = scanned;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function getGrayLevels(data) {
  const histogram = new Uint32Array(256);
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const gray = clamp(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[gray]++;
    count++;
  }

  const black = histogramPercentile(histogram, count, 0.04);
  const white = histogramPercentile(histogram, count, 0.9);
  return {
    black: Math.min(black, 95),
    white: Math.max(white, 188)
  };
}

function histogramPercentile(histogram, count, percentile) {
  const target = count * percentile;
  let seen = 0;

  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= target) return i;
  }

  return histogram.length - 1;
}

function normalizeLevel(value, black, white) {
  if (white <= black + 12) return value;
  return clamp(((value - black) / (white - black)) * 236 + 12);
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function renderPages() {
  els.pageList.replaceChildren();
  state.pages.forEach((page, index) => {
    const node = els.pageTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    image.src = page.processedDataUrl;
    image.alt = `Scanned page ${index + 1}`;
    node.querySelector("span").textContent = `Page ${index + 1}`;
    node.dataset.id = page.id;
    node.querySelector('[data-action="up"]').disabled = index === 0;
    node.querySelector('[data-action="down"]').disabled = index === state.pages.length - 1;
    els.pageList.append(node);
  });

  els.pageCount.textContent = String(state.pages.length);
  els.saveJpgButton.disabled = state.pages.length === 0;
  els.savePdfButton.disabled = state.pages.length === 0;
  els.clearButton.disabled = state.pages.length === 0;
  updatePreviewVisibility();
}

function handlePageAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const card = button.closest(".page-card");
  const index = state.pages.findIndex((page) => page.id === card.dataset.id);
  if (index < 0) return;

  if (button.dataset.action === "remove") {
    state.pages.splice(index, 1);
  }

  if (button.dataset.action === "up" && index > 0) {
    [state.pages[index - 1], state.pages[index]] = [state.pages[index], state.pages[index - 1]];
  }

  if (button.dataset.action === "down" && index < state.pages.length - 1) {
    [state.pages[index + 1], state.pages[index]] = [state.pages[index], state.pages[index + 1]];
  }

  renderPages();
}

function saveJpgPages() {
  if (!state.pages.length) return;
  state.pages.forEach((page, index) => {
    setTimeout(() => downloadDataUrl(page.processedDataUrl, `scan-page-${index + 1}.jpg`), index * 250);
  });
}

async function savePdf() {
  if (!state.pages.length) return;
  const pdfBytes = await buildPdf(state.pages, els.paperSelect.value);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  downloadBlob(blob, `scan-${formatDateForFile()}.pdf`);
}

async function buildPdf(pages, paperMode) {
  const objects = [];
  const pageRefs = [];

  const catalogId = addObject(objects, "<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject(objects, "");

  for (const page of pages) {
    const bytes = dataUrlToBytes(page.processedDataUrl);
    const imageId = objects.length + 1;
    const pageId = objects.length + 2;
    const contentId = objects.length + 3;
    const pageSize = pdfPageSize(page, paperMode);
    const placement = fitRect(page.width, page.height, pageSize.width, pageSize.height);

    const imageStream = bytesToBinaryString(bytes);
    const drawCommand = `q\n${placement.width.toFixed(2)} 0 0 ${placement.height.toFixed(2)} ${placement.x.toFixed(2)} ${placement.y.toFixed(2)} cm\n/Im${imageId} Do\nQ`;

    addObject(objects, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n${imageStream}\nendstream`);
    addObject(objects, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageSize.width.toFixed(2)} ${pageSize.height.toFixed(2)}] /Resources << /XObject << /Im${imageId} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    addObject(objects, `<< /Length ${drawCommand.length} >>\nstream\n${drawCommand}\nendstream`);
    pageRefs.push(`${pageId} 0 R`);
  }

  objects[catalogId - 1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;

  return encodePdf(objects);
}

function addObject(objects, content) {
  objects.push(content);
  return objects.length;
}

function encodePdf(objects) {
  const chunks = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];
  let length = chunks[0].length;

  objects.forEach((content, index) => {
    offsets.push(length);
    const object = `${index + 1} 0 obj\n${content}\nendobj\n`;
    chunks.push(object);
    length += object.length;
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(xref);

  return Uint8Array.from(chunks.join(""), (char) => char.charCodeAt(0) & 0xff);
}

function pdfPageSize(page, mode) {
  if (mode === "a4") return { width: 595.28, height: 841.89 };
  if (mode === "letter") return { width: 612, height: 792 };
  const width = Math.min(612, Math.max(240, page.width * 0.48));
  return { width, height: width * (page.height / page.width) };
}

function fitRect(srcWidth, srcHeight, destWidth, destHeight) {
  const scale = Math.min(destWidth / srcWidth, destHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return {
    width,
    height,
    x: (destWidth - width) / 2,
    y: (destHeight - height) / 2
  };
}

function clearPages() {
  state.pages = [];
  renderPages();
}

function drawPreview(canvas) {
  els.canvas.width = canvas.width;
  els.canvas.height = canvas.height;
  els.canvas.getContext("2d").drawImage(canvas, 0, 0);
  els.canvas.hidden = false;
  els.empty.hidden = true;
}

function drawImageToPreview(image) {
  els.canvas.width = image.naturalWidth;
  els.canvas.height = image.naturalHeight;
  els.canvas.getContext("2d").drawImage(image, 0, 0);
  els.canvas.hidden = false;
  els.empty.hidden = true;
}

function updatePreviewVisibility() {
  if (state.stream) return;
  const hasPreview = state.pages.length > 0;
  els.canvas.hidden = !hasPreview;
  els.empty.hidden = hasPreview;
}

function scaledSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",", 2)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBinaryString(bytes) {
  let result = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return result;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function formatDateForFile() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

async function installApp() {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice.catch(() => {});
  state.deferredInstall = null;
  els.installButton.hidden = true;
}
