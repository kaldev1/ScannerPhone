"use strict";

const state = {
  pages: [],
  stream: null,
  deferredInstall: null,
  guideFrame: 0,
  guideQuad: null,
  guideLastRun: 0,
  guideLastSeen: 0,
  focusTimer: 0,
  targetPages: null,
  reviewTimer: 0,
  pendingReviewPageId: null
};

const els = {
  video: document.querySelector("#cameraPreview"),
  canvas: document.querySelector("#workingCanvas"),
  documentGuide: document.querySelector("#documentGuide"),
  focusIndicator: document.querySelector("#focusIndicator"),
  empty: document.querySelector("#emptyState"),
  cameraButton: document.querySelector("#cameraButton"),
  snapButton: document.querySelector("#snapButton"),
  dockSnapButton: document.querySelector("#dockSnapButton"),
  dockCloseButton: document.querySelector("#dockCloseButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  cameraOverlay: document.querySelector("#cameraOverlay"),
  captureReviewOverlay: document.querySelector("#captureReviewOverlay"),
  captureReviewTitle: document.querySelector("#captureReviewTitle"),
  captureReviewStatus: document.querySelector("#captureReviewStatus"),
  reviewRetakeButton: document.querySelector("#reviewRetakeButton"),
  reviewKeepButton: document.querySelector("#reviewKeepButton"),
  cameraDock: document.querySelector("#cameraDock"),
  cameraInput: document.querySelector("#cameraInput"),
  fileInput: document.querySelector("#fileInput"),
  statusText: document.querySelector("#statusText"),
  targetPagesInput: document.querySelector("#targetPagesInput"),
  targetSummary: document.querySelector("#targetSummary"),
  captureProgressText: document.querySelector("#captureProgressText"),
  progressFill: document.querySelector("#progressFill"),
  qualityText: document.querySelector("#qualityText"),
  modeSelect: document.querySelector("#modeSelect"),
  paperSelect: document.querySelector("#paperSelect"),
  pdfNameInput: document.querySelector("#pdfNameInput"),
  autoCropInput: document.querySelector("#autoCropInput"),
  pageList: document.querySelector("#pageList"),
  pageCount: document.querySelector("#pageCount"),
  reviewTitle: document.querySelector("#reviewTitle"),
  pageTemplate: document.querySelector("#pageTemplate"),
  saveJpgButton: document.querySelector("#saveJpgButton"),
  savePdfButton: document.querySelector("#savePdfButton"),
  clearButton: document.querySelector("#clearButton"),
  retakeLastButton: document.querySelector("#retakeLastButton"),
  finishScanButton: document.querySelector("#finishScanButton"),
  appVersion: document.querySelector("#appVersion"),
  installButton: document.querySelector("#installButton")
};

const APP_VERSION = "1.1.0";
const MAX_SOURCE_EDGE = 4096;
const MAX_OUTPUT_EDGE = 3200;
const MAX_PREVIEW_EDGE = 1400;
const THUMBNAIL_EDGE = 480;
const ORIGINAL_JPEG_QUALITY = 0.98;
const OUTPUT_JPEG_QUALITY = 0.97;
const THUMBNAIL_JPEG_QUALITY = 0.86;
const GUIDE_DETECT_INTERVAL = 260;
const GUIDE_SAMPLE_EDGE = 760;
const CAPTURE_SAMPLE_EDGE = 1200;

init();

function init() {
  els.appVersion.textContent = "v" + APP_VERSION;
  els.appVersion.title = "ScannerPhone version " + APP_VERSION;
  bindEvents();
  updateTargetPages();
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
  els.reviewKeepButton.addEventListener("click", keepReviewedCapture);
  els.reviewRetakeButton.addEventListener("click", retakeReviewedCapture);
  els.cameraInput.addEventListener("change", handleCameraInput);
  els.fileInput.addEventListener("change", handleFileInput);
  els.targetPagesInput.addEventListener("input", updateTargetPages);
  els.modeSelect.addEventListener("change", reprocessAllPages);
  els.autoCropInput.addEventListener("change", reprocessAllPages);
  els.saveJpgButton.addEventListener("click", saveJpgPages);
  els.savePdfButton.addEventListener("click", savePdf);
  els.clearButton.addEventListener("click", clearPages);
  els.retakeLastButton.addEventListener("click", retakeLastPage);
  els.finishScanButton.addEventListener("click", finishScan);
  els.pageList.addEventListener("click", handlePageAction);
  els.installButton.addEventListener("click", installApp);
  els.video.addEventListener("pointerdown", handleFocusTap);
  els.documentGuide.addEventListener("pointerdown", handleFocusTap);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstall = event;
    els.installButton.hidden = false;
  });
}

async function startCamera() {
  updateTargetPages();
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Live preview needs HTTPS or localhost. Opening the phone camera instead.");
    els.cameraInput.click();
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2880 },
        aspectRatio: { ideal: 4 / 3 }
      },
      audio: false
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    await enableContinuousFocus();
    els.canvas.hidden = true;
    els.video.hidden = false;
    els.empty.hidden = true;
    els.cameraOverlay.hidden = false;
    els.documentGuide.hidden = false;
    els.cameraDock.hidden = false;
    els.cameraButton.hidden = true;
    els.stopCameraButton.hidden = false;
    setQuality("Aim at page", "needs-review");
    setStatus(nextCaptureMessage());
    startDocumentGuide();
  } catch (error) {
    setStatus(cameraErrorMessage(error));
    els.cameraInput.click();
  }
}

function stopCamera() {
  clearCaptureReview();
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
  els.captureReviewOverlay.hidden = true;
  els.documentGuide.hidden = true;
  els.cameraDock.hidden = true;
  els.cameraButton.hidden = false;
  els.stopCameraButton.hidden = true;
  setQuality(state.pages.length ? "Review" : "Ready");
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
  clearTimeout(state.focusTimer);
  state.focusTimer = 0;
  const ctx = els.documentGuide.getContext("2d");
  ctx.clearRect(0, 0, els.documentGuide.width, els.documentGuide.height);
  els.documentGuide.classList.remove("is-focusing", "is-focused", "focus-unsupported");
  els.focusIndicator.hidden = true;
  els.focusIndicator.classList.remove("is-focusing", "is-focused", "focus-unsupported");
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

  if (now - state.guideLastRun > GUIDE_DETECT_INTERVAL) {
    state.guideLastRun = now;
    const { frame, scaleX, scaleY } = captureGuideFrame();
    const detected = detectDocumentQuad(frame, GUIDE_SAMPLE_EDGE);
    const quad = detected?.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY
    }));

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

function captureGuideFrame() {
  const scale = Math.min(1, GUIDE_SAMPLE_EDGE / Math.max(els.video.videoWidth, els.video.videoHeight));
  const frame = document.createElement("canvas");
  frame.width = Math.max(1, Math.round(els.video.videoWidth * scale));
  frame.height = Math.max(1, Math.round(els.video.videoHeight * scale));
  frame.getContext("2d", { willReadFrequently: true }).drawImage(els.video, 0, 0, frame.width, frame.height);
  return {
    frame,
    scaleX: els.video.videoWidth / frame.width,
    scaleY: els.video.videoHeight / frame.height
  };
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

async function enableContinuousFocus() {
  const track = state.stream?.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;
  const capabilities = track.getCapabilities();
  const settings = {};

  if (capabilities.focusMode?.includes("continuous")) {
    settings.focusMode = "continuous";
  }

  if (capabilities.exposureMode?.includes("continuous")) {
    settings.exposureMode = "continuous";
  }

  if (capabilities.whiteBalanceMode?.includes("continuous")) {
    settings.whiteBalanceMode = "continuous";
  }

  if (Object.keys(settings).length) {
    await track.applyConstraints({ advanced: [settings] }).catch(() => {});
  }
}

async function handleFocusTap(event) {
  if (!state.stream || els.video.hidden) return;
  const rect = els.video.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

  showFocusBox(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, "is-focusing");
  const focused = await requestCameraFocus(x, y);
  showFocusBox(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, focused ? "is-focused" : "focus-unsupported");
}

async function requestCameraFocus(x, y) {
  const track = state.stream?.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return false;
  const capabilities = track.getCapabilities();
  const focusConstraints = {};

  if (capabilities.pointsOfInterest) {
    focusConstraints.pointsOfInterest = [{ x, y }];
  }

  if (capabilities.focusMode?.includes("single-shot")) {
    focusConstraints.focusMode = "single-shot";
  } else if (capabilities.focusMode?.includes("continuous")) {
    focusConstraints.focusMode = "continuous";
  }

  if (!Object.keys(focusConstraints).length) return false;

  try {
    await track.applyConstraints({ advanced: [focusConstraints] });
    return true;
  } catch {
    return false;
  }
}

function showFocusBox(x, y, width, height, className) {
  const boxSize = Math.max(54, Math.min(82, Math.min(width, height) * 0.18));
  els.focusIndicator.style.setProperty("--focus-x", `${Math.max(0, Math.min(width - boxSize, x - boxSize / 2))}px`);
  els.focusIndicator.style.setProperty("--focus-y", `${Math.max(0, Math.min(height - boxSize, y - boxSize / 2))}px`);
  els.focusIndicator.style.setProperty("--focus-size", `${boxSize}px`);
  els.focusIndicator.hidden = false;
  els.focusIndicator.classList.remove("is-focusing", "is-focused", "focus-unsupported");
  els.focusIndicator.classList.add(className);

  clearTimeout(state.focusTimer);
  state.focusTimer = setTimeout(() => {
    els.focusIndicator.hidden = true;
    els.focusIndicator.classList.remove("is-focusing", "is-focused", "focus-unsupported");
  }, className === "is-focusing" ? 1300 : 850);
}

async function captureFromCamera() {
  if (!els.video.videoWidth || !els.video.videoHeight) return;
  clearCaptureReview();
  els.snapButton.disabled = true;
  els.dockSnapButton.disabled = true;
  try {
    setQuality("Capturing", "needs-review");
    setStatus("Capturing a sharp frame...");
    const capture = await captureSharpFrame();
    const page = await addImageCanvas(capture.canvas, { sharpness: capture.score });
    resetDocumentGuideDetection();
    const targetReached = state.targetPages && state.pages.length >= state.targetPages;
    if (targetReached) {
      finishScan();
      setStatus(`Captured ${state.pages.length} pages. Review the PDF before saving.`);
    } else {
      showCaptureReview(page);
    }
  } finally {
    els.snapButton.disabled = false;
    els.dockSnapButton.disabled = false;
  }
}

function resetDocumentGuideDetection() {
  state.guideQuad = null;
  state.guideLastRun = 0;
  state.guideLastSeen = 0;
  const ctx = els.documentGuide.getContext("2d");
  ctx.clearRect(0, 0, els.documentGuide.width, els.documentGuide.height);
}

function showCaptureReview(page) {
  state.pendingReviewPageId = page.id;
  els.video.hidden = true;
  els.canvas.hidden = false;
  els.cameraOverlay.hidden = true;
  els.cameraDock.hidden = true;
  els.documentGuide.hidden = true;
  els.captureReviewOverlay.hidden = false;
  els.captureReviewTitle.textContent = `Page ${state.pages.length} captured`;

  if (page.warnings?.length) {
    els.captureReviewStatus.textContent = `Check: ${page.warnings.join(", ")}`;
    setStatus("Review this scan before continuing.");
    setQuality("Review", "needs-review");
    return;
  }

  els.captureReviewStatus.textContent = "Auto continuing...";
  setStatus("Scan looks good. Returning to camera.");
  state.reviewTimer = setTimeout(keepReviewedCapture, 1800);
}

function keepReviewedCapture() {
  if (!state.pendingReviewPageId) return;
  clearCaptureReview();
  resumeLiveCapture();
  setStatus(nextCaptureMessage());
}

function retakeReviewedCapture() {
  if (!state.pendingReviewPageId) return;
  const index = state.pages.findIndex((page) => page.id === state.pendingReviewPageId);
  if (index >= 0) {
    state.pages.splice(index, 1);
  }
  clearCaptureReview();
  renderPages();
  resumeLiveCapture();
  setStatus(nextCaptureMessage());
}

function clearCaptureReview() {
  clearTimeout(state.reviewTimer);
  state.reviewTimer = 0;
  state.pendingReviewPageId = null;
  els.captureReviewOverlay.hidden = true;
}

function resumeLiveCapture() {
  if (!state.stream) return;
  els.canvas.hidden = true;
  els.empty.hidden = true;
  els.video.hidden = false;
  els.cameraOverlay.hidden = false;
  els.cameraDock.hidden = false;
  els.documentGuide.hidden = false;
  startDocumentGuide();
  setQuality("Aim at page", "needs-review");
}

async function captureSharpFrame() {
  const nativeStill = await captureNativeStillFrame();
  if (nativeStill) {
    return { canvas: nativeStill, score: estimateSharpness(nativeStill) };
  }

  let best = null;
  let bestScore = -1;

  for (let i = 0; i < 7; i++) {
    if (i > 0) await wait(120);
    const frame = captureVideoFrame();
    const score = estimateSharpness(frame);
    if (score > bestScore) {
      releaseCanvas(best);
      best = frame;
      bestScore = score;
    } else {
      releaseCanvas(frame);
    }
  }

  return { canvas: best, score: bestScore };
}

async function captureNativeStillFrame() {
  const track = state.stream?.getVideoTracks?.()[0];
  if (!track || typeof ImageCapture !== "function") return null;

  try {
    const capture = new ImageCapture(track);
    const photoSettings = await getBestPhotoSettings(capture);
    let blob;

    try {
      blob = photoSettings ? await capture.takePhoto(photoSettings) : await capture.takePhoto();
    } catch (error) {
      if (!photoSettings) throw error;
      blob = await capture.takePhoto();
    }

    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      return imageToCanvas(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

async function getBestPhotoSettings(capture) {
  if (typeof capture.getPhotoCapabilities !== "function") return null;

  try {
    const capabilities = await capture.getPhotoCapabilities();
    const maxWidth = capabilities.imageWidth?.max;
    const maxHeight = capabilities.imageHeight?.max;
    if (!Number.isFinite(maxWidth) || !Number.isFinite(maxHeight)) return null;

    const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(maxWidth, maxHeight));
    return {
      imageWidth: fitPhotoDimension(maxWidth * scale, capabilities.imageWidth),
      imageHeight: fitPhotoDimension(maxHeight * scale, capabilities.imageHeight)
    };
  } catch {
    return null;
  }
}

function fitPhotoDimension(value, range) {
  const minimum = Number.isFinite(range.min) ? range.min : 1;
  const maximum = Number.isFinite(range.max) ? range.max : value;
  const clamped = Math.max(minimum, Math.min(maximum, value));
  if (!Number.isFinite(range.step) || range.step <= 0) return Math.round(clamped);
  const stepped = minimum + Math.round((clamped - minimum) / range.step) * range.step;
  return Math.round(Math.max(minimum, Math.min(maximum, stepped)));
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

function captureVideoFrame() {
  const source = document.createElement("canvas");
  const size = scaledSize(els.video.videoWidth, els.video.videoHeight, MAX_SOURCE_EDGE);
  source.width = size.width;
  source.height = size.height;
  const ctx = source.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(els.video, 0, 0, size.width, size.height);
  return source;
}

function estimateSharpness(canvas) {
  const sampleWidth = 180;
  const sampleHeight = Math.max(1, Math.round(sampleWidth * (canvas.height / canvas.width)));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let score = 0;

  for (let y = 1; y < sampleHeight - 1; y++) {
    for (let x = 1; x < sampleWidth - 1; x++) {
      const index = (y * sampleWidth + x) * 4;
      const left = ((y * sampleWidth + x - 1) * 4);
      const right = ((y * sampleWidth + x + 1) * 4);
      const up = (((y - 1) * sampleWidth + x) * 4);
      const down = (((y + 1) * sampleWidth + x) * 4);
      const center = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      const neighbors =
        0.299 * data[left] + 0.587 * data[left + 1] + 0.114 * data[left + 2] +
        0.299 * data[right] + 0.587 * data[right + 1] + 0.114 * data[right + 2] +
        0.299 * data[up] + 0.587 * data[up + 1] + 0.114 * data[up + 2] +
        0.299 * data[down] + 0.587 * data[down + 1] + 0.114 * data[down + 2];
      score += Math.abs(center * 4 - neighbors);
    }
  }

  return score / (sampleWidth * sampleHeight);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleCameraInput(event) {
  const file = event.target.files?.[0];
  if (file?.type.startsWith("image/")) {
    await addImageFileSafe(file);
  }
  event.target.value = "";
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files || []);
  let added = 0;
  let failed = 0;

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      if (await addImageFileSafe(file, { quiet: true })) {
        added++;
      } else {
        failed++;
      }
    }
  }

  if (failed) {
    setStatus(`${added} image${added === 1 ? "" : "s"} added. ${failed} image${failed === 1 ? "" : "s"} could not be read.`);
  }

  event.target.value = "";
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setQuality(label, className = "") {
  els.qualityText.textContent = label;
  els.qualityText.classList.toggle("needs-review", className === "needs-review");
  els.qualityText.classList.toggle("bad", className === "bad");
}

function updateTargetPages() {
  const value = Number.parseInt(els.targetPagesInput.value, 10);
  state.targetPages = Number.isFinite(value) && value > 0 ? value : null;
  renderSessionProgress();
}

function renderSessionProgress() {
  const total = state.targetPages;
  const count = state.pages.length;
  els.targetSummary.textContent = total ? `Batch scan: ${total} pages` : "Batch scan: open ended";
  els.captureProgressText.textContent = total ? `${Math.min(count, total)} of ${total} pages captured` : `${count} page${count === 1 ? "" : "s"} captured`;
  const percent = total ? Math.min(100, (count / total) * 100) : count ? 100 : 0;
  els.progressFill.style.width = `${percent}%`;
  els.reviewTitle.textContent = total ? `Review PDF (${count}/${total})` : "Review PDF";
}

function nextCaptureMessage() {
  const next = state.pages.length + 1;
  if (state.targetPages) {
    return `Capture page ${Math.min(next, state.targetPages)} of ${state.targetPages}.`;
  }
  return `Capture page ${next}, or review the PDF when done.`;
}

function assessCaptureQuality(source, processed, sharpness) {
  const warnings = [];
  const brightness = estimateBrightness(source);
  const coverage = (processed.canvas.width * processed.canvas.height) / (source.width * source.height);

  if (Number.isFinite(sharpness) && sharpness < 18) {
    warnings.push("soft focus");
  }

  if (brightness < 72) {
    warnings.push("low light");
  } else if (brightness > 230) {
    warnings.push("very bright");
  }

  if (els.autoCropInput.checked && processed.cropMode === "none") {
    warnings.push("edges not found");
  }

  if (processed.cropMode !== "none" && coverage < 0.16) {
    warnings.push("small page area");
  }

  if (!warnings.length) {
    return { label: "Sharp", className: "", warnings };
  }

  if (warnings.includes("soft focus") || warnings.includes("edges not found")) {
    return { label: "Review", className: "needs-review", warnings };
  }

  return { label: "Check", className: "needs-review", warnings };
}

function estimateBrightness(canvas) {
  const sampleWidth = 120;
  const sampleHeight = Math.max(1, Math.round(sampleWidth * (canvas.height / canvas.width)));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  return total / (data.length / 4);
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
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const source = imageToCanvas(image);
    await addImageCanvas(source, { sharpness: estimateSharpness(source) });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageToCanvas(image) {
  const source = document.createElement("canvas");
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const { width, height } = scaledSize(naturalWidth, naturalHeight, MAX_SOURCE_EDGE);
  source.width = width;
  source.height = height;
  const ctx = source.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return source;
}

async function addImageFileSafe(file, options = {}) {
  try {
    await addImageFile(file);
    return true;
  } catch {
    if (!options.quiet) {
      setQuality("Import failed", "bad");
      setStatus("That image could not be read. Try another photo.");
    }
    return false;
  }
}

async function addImageCanvas(source, capture = {}) {
  const originalDataUrl = source.toDataURL("image/jpeg", ORIGINAL_JPEG_QUALITY);
  const processed = processCanvas(source);
  const quality = assessCaptureQuality(source, processed, capture.sharpness);
  const page = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    originalDataUrl,
    processedDataUrl: processed.canvas.toDataURL("image/jpeg", OUTPUT_JPEG_QUALITY),
    thumbnailDataUrl: createThumbnailDataUrl(processed.canvas),
    width: processed.canvas.width,
    height: processed.canvas.height,
    cropMode: processed.cropMode,
    warnings: quality.warnings,
    qualityLabel: quality.label
  };
  state.pages.push(page);
  setQuality(quality.label, quality.className);
  drawPreview(processed.canvas);
  renderPages();
  return page;
}

async function reprocessAllPages() {
  for (const page of state.pages) {
    const image = await loadImage(page.originalDataUrl);
    const source = document.createElement("canvas");
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    source.getContext("2d").drawImage(image, 0, 0);
    const processed = processCanvas(source);
    const quality = assessCaptureQuality(source, processed, estimateSharpness(source));
    page.processedDataUrl = processed.canvas.toDataURL("image/jpeg", OUTPUT_JPEG_QUALITY);
    page.thumbnailDataUrl = createThumbnailDataUrl(processed.canvas);
    page.width = processed.canvas.width;
    page.height = processed.canvas.height;
    page.cropMode = processed.cropMode;
    page.warnings = quality.warnings;
    page.qualityLabel = quality.label;
  }

  if (state.pages.length) {
    const image = await loadImage(state.pages[state.pages.length - 1].thumbnailDataUrl);
    drawImageToPreview(image);
  }
  renderPages();
}

function processCanvas(source) {
  let canvas = document.createElement("canvas");
  const quad = els.autoCropInput.checked ? detectDocumentQuad(source) : null;
  let cropMode = "none";

  if (quad) {
    canvas = warpDocument(source, quad);
    cropMode = "quad";
  } else {
    const crop = els.autoCropInput.checked ? detectDocumentBounds(source) : null;
    const src = crop || { x: 0, y: 0, width: source.width, height: source.height };
    cropMode = crop ? "bounds" : "none";
    const size = scaledSize(src.width, src.height, MAX_OUTPUT_EDGE);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, src.x, src.y, src.width, src.height, 0, 0, canvas.width, canvas.height);
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  applyScanFilter(ctx, canvas.width, canvas.height, els.modeSelect.value);
  return { canvas, cropMode };
}

function detectDocumentQuad(canvas, sampleEdge = CAPTURE_SAMPLE_EDGE) {
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
  const masks = [
    createDocumentMask(luminance, width, height, mean, borderMean),
    createAdaptiveDocumentMask(luminance, width, height, mean, borderMean)
  ];
  let component = null;

  for (const mask of masks) {
    closeMask(mask, width, height, 3);
    const candidate = findBestDocumentComponent(mask, width, height);
    if (!component || (candidate?.score || 0) > component.score) {
      component = candidate;
    }
  }

  if (!component?.corners) {
    return detectFallbackQuad(luminance, width, height, scale);
  }

  const quad = orderQuad(component.corners).map((point) => ({
    x: Math.round(point.x / scale),
    y: Math.round(point.y / scale)
  }));

  if (!isUsableQuad(quad, canvas.width, canvas.height)) {
    return detectFallbackQuad(luminance, width, height, scale);
  }
  return quad;
}

function detectFallbackQuad(luminance, width, height, scale) {
  const bounds = detectFallbackBounds(luminance, width, height, 1);
  if (!bounds) return null;

  const quad = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height }
  ].map((point) => ({
    x: Math.round(point.x / scale),
    y: Math.round(point.y / scale)
  }));

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

function createAdaptiveDocumentMask(luminance, width, height, mean, borderMean) {
  const mask = new Uint8Array(width * height);
  const radius = Math.max(10, Math.round(Math.min(width, height) * 0.045));
  const integral = buildIntegralImage(luminance, width, height);

  for (let y = 1; y < height - 1; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 1; x < width - 1; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const index = y * width + x;
      const local = localMean(integral, width, left, top, right, bottom);
      const edge =
        Math.abs(luminance[index + 1] - luminance[index - 1]) +
        Math.abs(luminance[index + width] - luminance[index - width]);
      const brighterThanLocal = luminance[index] > local + 10 && luminance[index] > borderMean + 10;
      const paperTone = luminance[index] > Math.max(138, mean - 8) && edge < 76;

      if (brighterThanLocal || paperTone) {
        mask[index] = 1;
      }
    }
  }

  return mask;
}

function buildIntegralImage(luminance, width, height) {
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowTotal = 0;
    const sourceOffset = y * width;
    const integralOffset = (y + 1) * (width + 1);
    const previousOffset = y * (width + 1);

    for (let x = 0; x < width; x++) {
      rowTotal += luminance[sourceOffset + x];
      integral[integralOffset + x + 1] = integral[previousOffset + x + 1] + rowTotal;
    }
  }

  return integral;
}

function localMean(integral, width, left, top, right, bottom) {
  const stride = width + 1;
  const x1 = left;
  const y1 = top;
  const x2 = right + 1;
  const y2 = bottom + 1;
  const total =
    integral[y2 * stride + x2] -
    integral[y1 * stride + x2] -
    integral[y2 * stride + x1] +
    integral[y1 * stride + x1];
  return total / ((right - left + 1) * (bottom - top + 1));
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
  const input = sourceCtx.getImageData(0, 0, source.width, source.height).data;
  const output = ctx.createImageData(canvas.width, canvas.height);
  const target = output.data;
  const transform = squareToQuad(quad);
  const uStep = canvas.width > 1 ? 1 / (canvas.width - 1) : 0;
  const vStep = canvas.height > 1 ? 1 / (canvas.height - 1) : 0;
  const numeratorXStep = transform.a * uStep;
  const numeratorYStep = transform.d * uStep;
  const denominatorStep = transform.g * uStep;

  for (let y = 0; y < canvas.height; y++) {
    const v = y * vStep;
    let numeratorX = transform.b * v + transform.c;
    let numeratorY = transform.e * v + transform.f;
    let denominator = transform.h * v + 1;

    for (let x = 0; x < canvas.width; x++) {
      const divisor = Math.abs(denominator) < 1e-8 ? 1e-8 : denominator;
      const sourceX = Math.max(0, Math.min(source.width - 1, numeratorX / divisor));
      const sourceY = Math.max(0, Math.min(source.height - 1, numeratorY / divisor));
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const y1 = Math.min(source.height - 1, y0 + 1);
      const tx = sourceX - x0;
      const ty = sourceY - y0;
      const topWeight = 1 - ty;
      const leftWeight = 1 - tx;
      const topLeft = (y0 * source.width + x0) * 4;
      const topRight = (y0 * source.width + x1) * 4;
      const bottomLeft = (y1 * source.width + x0) * 4;
      const bottomRight = (y1 * source.width + x1) * 4;
      const targetIndex = (y * canvas.width + x) * 4;

      for (let channel = 0; channel < 3; channel++) {
        target[targetIndex + channel] =
          input[topLeft + channel] * leftWeight * topWeight +
          input[topRight + channel] * tx * topWeight +
          input[bottomLeft + channel] * leftWeight * ty +
          input[bottomRight + channel] * tx * ty;
      }
      target[targetIndex + 3] = 255;

      numeratorX += numeratorXStep;
      numeratorY += numeratorYStep;
      denominator += denominatorStep;
    }
  }

  ctx.putImageData(output, 0, 0);
  return canvas;
}

function squareToQuad([tl, tr, br, bl]) {
  const dx1 = tr.x - br.x;
  const dx2 = bl.x - br.x;
  const dx3 = tl.x - tr.x + br.x - bl.x;
  const dy1 = tr.y - br.y;
  const dy2 = bl.y - br.y;
  const dy3 = tl.y - tr.y + br.y - bl.y;
  const divisor = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;

  if ((Math.abs(dx3) > 1e-8 || Math.abs(dy3) > 1e-8) && Math.abs(divisor) > 1e-8) {
    g = (dx3 * dy2 - dx2 * dy3) / divisor;
    h = (dx1 * dy3 - dx3 * dy1) / divisor;
  }

  return {
    a: tr.x - tl.x + g * tr.x,
    b: bl.x - tl.x + h * bl.x,
    c: tl.x,
    d: tr.y - tl.y + g * tr.y,
    e: bl.y - tl.y + h * bl.y,
    f: tl.y,
    g,
    h
  };
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

  if (mode === "document") {
    applyDocumentFilter(data, width, height);
  } else if (mode === "color") {
    applyColorFilter(data, width, height);
  } else {
    applyGrayscaleFilter(data);
  }

  ctx.putImageData(imageData, 0, 0);
}

function applyDocumentFilter(data, width, height) {
  const luminance = extractLuminance(data);
  const illumination = estimateIllumination(luminance, width, height);
  const axes = createGridAxes(width, height, illumination);
  const corrected = new Uint8ClampedArray(luminance.length);
  const histogram = new Uint32Array(256);

  for (let y = 0; y < height; y++) {
    const row0 = axes.y0[y] * illumination.width;
    const row1 = axes.y1[y] * illumination.width;
    const yMix = axes.yMix[y];
    const inverseY = 1 - yMix;
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const inverseX = 1 - axes.xMix[x];
      const top =
        illumination.values[row0 + axes.x0[x]] * inverseX +
        illumination.values[row0 + axes.x1[x]] * axes.xMix[x];
      const bottom =
        illumination.values[row1 + axes.x0[x]] * inverseX +
        illumination.values[row1 + axes.x1[x]] * axes.xMix[x];
      const background = top * inverseY + bottom * yMix;
      const correction = clampFloat(242 / Math.max(88, background), 0.9, 1.75);
      const value = clamp(luminance[rowOffset + x] * (1 + (correction - 1) * 0.9));
      corrected[rowOffset + x] = value;
      histogram[value]++;
    }
  }

  const black = Math.min(histogramPercentile(histogram, corrected.length, 0.035), 112);
  const white = Math.max(histogramPercentile(histogram, corrected.length, 0.9), 214);
  const tones = new Uint8ClampedArray(corrected.length);

  for (let i = 0; i < corrected.length; i++) {
    const normalized = normalizeDocumentLevel(corrected[i], black, white);
    let value = corrected[i] * 0.34 + normalized * 0.66;

    if (value > 190) {
      value += (252 - value) * 0.42;
    } else if (value < 150) {
      value -= (150 - value) * 0.08;
    }

    tones[i] = clamp(value);
  }

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const index = rowOffset + x;
      const center = tones[index];
      let value = center;

      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const edge =
          center * 4 -
          tones[index - 1] -
          tones[index + 1] -
          tones[index - width] -
          tones[index + width];

        if (Math.abs(edge) > 4) {
          value += edge * (center < 215 ? 0.2 : 0.07);
        }
      }

      const outputIndex = index * 4;
      const scanned = clamp(value);
      data[outputIndex] = scanned;
      data[outputIndex + 1] = scanned;
      data[outputIndex + 2] = scanned;
    }
  }
}

function applyColorFilter(data, width, height) {
  const luminance = extractLuminance(data);
  const illumination = estimateIllumination(luminance, width, height);
  const axes = createGridAxes(width, height, illumination);
  const whitePoint = estimateWhitePoint(data);
  const neutral = Math.max(210, whitePoint.r, whitePoint.g, whitePoint.b);
  const redBalance = clampFloat(neutral / Math.max(1, whitePoint.r), 0.88, 1.16);
  const greenBalance = clampFloat(neutral / Math.max(1, whitePoint.g), 0.88, 1.16);
  const blueBalance = clampFloat(neutral / Math.max(1, whitePoint.b), 0.88, 1.16);

  for (let y = 0; y < height; y++) {
    const row0 = axes.y0[y] * illumination.width;
    const row1 = axes.y1[y] * illumination.width;
    const yMix = axes.yMix[y];
    const inverseY = 1 - yMix;
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const inverseX = 1 - axes.xMix[x];
      const top =
        illumination.values[row0 + axes.x0[x]] * inverseX +
        illumination.values[row0 + axes.x1[x]] * axes.xMix[x];
      const bottom =
        illumination.values[row1 + axes.x0[x]] * inverseX +
        illumination.values[row1 + axes.x1[x]] * axes.xMix[x];
      const background = top * inverseY + bottom * yMix;
      const correction = clampFloat(238 / Math.max(92, background), 0.88, 1.55);
      const localGain = 1 + (correction - 1) * 0.78;
      const index = (rowOffset + x) * 4;
      const r = data[index] * localGain * redBalance;
      const g = data[index + 1] * localGain * greenBalance;
      const b = data[index + 2] * localGain * blueBalance;

      data[index] = clamp((r - 128) * 1.07 + 130);
      data[index + 1] = clamp((g - 128) * 1.07 + 130);
      data[index + 2] = clamp((b - 128) * 1.07 + 130);
    }
  }
}

function applyGrayscaleFilter(data) {
  const levels = getGrayLevels(data);

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const normalized = normalizeLevel(gray, levels.black, levels.white);
    const value = clamp(((gray * 0.42 + normalized * 0.58) - 128) * 1.1 + 130);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
}

function extractLuminance(data) {
  const luminance = new Uint8ClampedArray(data.length / 4);

  for (let i = 0; i < data.length; i += 4) {
    luminance[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  return luminance;
}

function estimateIllumination(luminance, width, height) {
  const cellSize = Math.max(32, Math.round(Math.min(width, height) / 28));
  const gridWidth = Math.max(1, Math.ceil(width / cellSize));
  const gridHeight = Math.max(1, Math.ceil(height / cellSize));
  const grid = new Float32Array(gridWidth * gridHeight);
  const histogram = new Uint32Array(256);
  const sampleStride = cellSize > 72 ? 3 : 2;

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      histogram.fill(0);
      let count = 0;
      const startX = gx * cellSize;
      const startY = gy * cellSize;
      const endX = Math.min(width, startX + cellSize);
      const endY = Math.min(height, startY + cellSize);

      for (let y = startY; y < endY; y += sampleStride) {
        const rowOffset = y * width;
        for (let x = startX; x < endX; x += sampleStride) {
          histogram[luminance[rowOffset + x]]++;
          count++;
        }
      }

      grid[gy * gridWidth + gx] = histogramPercentile(histogram, count, 0.82);
    }
  }

  return {
    values: smoothIlluminationGrid(grid, gridWidth, gridHeight),
    width: gridWidth,
    height: gridHeight,
    cellSize
  };
}

function smoothIlluminationGrid(grid, width, height) {
  let values = grid;

  for (let pass = 0; pass < 2; pass++) {
    const smoothed = new Float32Array(values.length);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let total = 0;
        let weightTotal = 0;

        for (let dy = -1; dy <= 1; dy++) {
          const sourceY = Math.max(0, Math.min(height - 1, y + dy));
          const yWeight = dy === 0 ? 2 : 1;

          for (let dx = -1; dx <= 1; dx++) {
            const sourceX = Math.max(0, Math.min(width - 1, x + dx));
            const weight = yWeight * (dx === 0 ? 2 : 1);
            total += values[sourceY * width + sourceX] * weight;
            weightTotal += weight;
          }
        }

        smoothed[y * width + x] = total / weightTotal;
      }
    }

    values = smoothed;
  }

  return values;
}

function createGridAxes(width, height, grid) {
  const xAxis = createGridAxis(width, grid.cellSize, grid.width);
  const yAxis = createGridAxis(height, grid.cellSize, grid.height);

  return {
    x0: xAxis.low,
    x1: xAxis.high,
    xMix: xAxis.mix,
    y0: yAxis.low,
    y1: yAxis.high,
    yMix: yAxis.mix
  };
}

function createGridAxis(length, cellSize, gridLength) {
  const low = new Uint16Array(length);
  const high = new Uint16Array(length);
  const mix = new Float32Array(length);

  for (let index = 0; index < length; index++) {
    const position = Math.max(0, Math.min(gridLength - 1, index / cellSize - 0.5));
    low[index] = Math.floor(position);
    high[index] = Math.min(gridLength - 1, low[index] + 1);
    mix[index] = position - low[index];
  }

  return { low, high, mix };
}

function estimateWhitePoint(data) {
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  let count = 0;

  for (let i = 0; i < data.length; i += 16) {
    red[data[i]]++;
    green[data[i + 1]]++;
    blue[data[i + 2]]++;
    count++;
  }

  return {
    r: histogramPercentile(red, count, 0.9),
    g: histogramPercentile(green, count, 0.9),
    b: histogramPercentile(blue, count, 0.9)
  };
}

function normalizeDocumentLevel(value, black, white) {
  if (white <= black + 18) return value;
  return clamp(((value - black) / (white - black)) * 242 + 8);
}

function clampFloat(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function getGrayLevels(data) {
  const histogram = new Uint32Array(256);
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const gray = clamp(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[gray]++;
    count++;
  }

  const black = histogramPercentile(histogram, count, 0.06);
  const white = histogramPercentile(histogram, count, 0.92);
  return {
    black: Math.min(black, 118),
    white: Math.max(white, 198)
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
  return clamp(((value - black) / (white - black)) * 224 + 18);
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function renderPages() {
  els.pageList.replaceChildren();
  state.pages.forEach((page, index) => {
    const node = els.pageTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    image.src = page.thumbnailDataUrl || page.processedDataUrl;
    image.alt = `Scanned page ${index + 1}`;
    node.querySelector("span").textContent = `Page ${index + 1}`;
    node.dataset.id = page.id;
    node.querySelector('[data-action="up"]').disabled = index === 0;
    node.querySelector('[data-action="down"]').disabled = index === state.pages.length - 1;
    const warning = node.querySelector(".page-warning");
    if (page.warnings?.length) {
      warning.textContent = page.warnings.join(", ");
      warning.hidden = false;
    }
    els.pageList.append(node);
  });

  els.pageCount.textContent = String(state.pages.length);
  els.saveJpgButton.disabled = state.pages.length === 0;
  els.savePdfButton.disabled = state.pages.length === 0;
  els.clearButton.disabled = state.pages.length === 0;
  els.retakeLastButton.disabled = state.pages.length === 0;
  els.finishScanButton.disabled = state.pages.length === 0;
  renderSessionProgress();
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

function retakeLastPage() {
  if (state.pendingReviewPageId) {
    retakeReviewedCapture();
    return;
  }

  if (!state.pages.length) return;
  state.pages.pop();
  renderPages();
  els.canvas.hidden = true;
  els.empty.hidden = true;

  if (state.stream) {
    setQuality("Aim at page", "needs-review");
    setStatus(nextCaptureMessage());
    return;
  }

  setQuality("Aim at page", "needs-review");
  setStatus("Last page removed. Capture the replacement page.");
  startCamera();
}

function finishScan() {
  clearCaptureReview();
  stopCamera();
  setQuality(state.pages.length ? "Review" : "Ready");
  setStatus(state.pages.length ? "Review pages, retake any weak scans, then save the PDF." : "No pages captured yet.");
  els.pageList.scrollIntoView({ behavior: "smooth", block: "start" });
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
  downloadBlob(blob, `${pdfBaseName()}-${formatDateForFile()}.pdf`);
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
  clearCaptureReview();
  state.pages = [];
  setQuality("Ready");
  setStatus("Set a page count or leave it blank, then start scanning.");
  renderPages();
}

function createThumbnailDataUrl(source) {
  const size = scaledSize(source.width, source.height, THUMBNAIL_EDGE);
  const thumbnail = document.createElement("canvas");
  thumbnail.width = size.width;
  thumbnail.height = size.height;
  const ctx = thumbnail.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return thumbnail.toDataURL("image/jpeg", THUMBNAIL_JPEG_QUALITY);
}

function drawPreview(canvas) {
  const size = scaledSize(canvas.width, canvas.height, MAX_PREVIEW_EDGE);
  els.canvas.width = size.width;
  els.canvas.height = size.height;
  const ctx = els.canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, size.width, size.height);
  if (state.stream && !els.captureReviewOverlay.hidden) {
    els.canvas.hidden = true;
    return;
  }
  els.video.hidden = true;
  els.empty.hidden = true;
  els.canvas.hidden = false;
}

function drawImageToPreview(image) {
  const size = scaledSize(image.naturalWidth, image.naturalHeight, MAX_PREVIEW_EDGE);
  els.canvas.width = size.width;
  els.canvas.height = size.height;
  const ctx = els.canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, size.width, size.height);
  if (state.stream && !els.captureReviewOverlay.hidden) {
    els.canvas.hidden = true;
    return;
  }
  els.video.hidden = true;
  els.empty.hidden = true;
  els.canvas.hidden = false;
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

function pdfBaseName() {
  const value = els.pdfNameInput.value.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return value || "scan";
}

async function installApp() {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice.catch(() => {});
  state.deferredInstall = null;
  els.installButton.hidden = true;
}
