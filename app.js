"use strict";

const state = {
  pages: [],
  stream: null,
  deferredInstall: null
};

const els = {
  video: document.querySelector("#cameraPreview"),
  canvas: document.querySelector("#workingCanvas"),
  empty: document.querySelector("#emptyState"),
  cameraButton: document.querySelector("#cameraButton"),
  snapButton: document.querySelector("#snapButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
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
    els.snapButton.hidden = false;
    els.stopCameraButton.hidden = false;
  } catch (error) {
    setStatus(cameraErrorMessage(error));
    els.cameraInput.click();
  }
}

function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }
  state.stream = null;
  els.video.srcObject = null;
  els.video.hidden = true;
  els.snapButton.hidden = true;
  els.stopCameraButton.hidden = true;
  updatePreviewVisibility();
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
  const crop = els.autoCropInput.checked ? detectDocumentBounds(source) : null;
  const canvas = document.createElement("canvas");
  const src = crop || { x: 0, y: 0, width: source.width, height: source.height };
  const size = scaledSize(src.width, src.height, MAX_OUTPUT_EDGE);
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, src.x, src.y, src.width, src.height, 0, 0, canvas.width, canvas.height);
  applyScanFilter(ctx, canvas.width, canvas.height, els.modeSelect.value);
  return { canvas };
}

function detectDocumentBounds(canvas) {
  const sampleEdge = 700;
  const scale = Math.min(1, sampleEdge / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const luminance = [];
  let sum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luminance.push(value);
    sum += value;
  }

  const mean = sum / luminance.length;
  const threshold = Math.min(225, Math.max(95, mean + 18));
  let minX = sample.width;
  let minY = sample.height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 0; y < sample.height; y++) {
    for (let x = 0; x < sample.width; x++) {
      const value = luminance[y * sample.width + x];
      if (value >= threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hits++;
      }
    }
  }

  const coverage = hits / luminance.length;
  if (coverage < 0.12 || coverage > 0.92 || maxX <= minX || maxY <= minY) {
    return null;
  }

  const pad = Math.round(Math.min(sample.width, sample.height) * 0.025);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(sample.width - 1, maxX + pad);
  maxY = Math.min(sample.height - 1, maxY + pad);

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
  const contrast = mode === "document" ? 1.48 : mode === "color" ? 1.18 : 1.22;
  const brightness = mode === "document" ? 10 : mode === "color" ? 4 : 0;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray;
      g = gray;
      b = gray;
    }

    data[i] = clamp((r - 128) * contrast + 128 + brightness);
    data[i + 1] = clamp((g - 128) * contrast + 128 + brightness);
    data[i + 2] = clamp((b - 128) * contrast + 128 + brightness);

    if (mode === "document") {
      const v = data[i];
      const cleaned = v > 210 ? 255 : v < 48 ? 0 : v;
      data[i] = cleaned;
      data[i + 1] = cleaned;
      data[i + 2] = cleaned;
    }
  }

  ctx.putImageData(imageData, 0, 0);
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
