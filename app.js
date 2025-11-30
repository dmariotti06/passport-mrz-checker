// --- PWA : enregistrement du service worker ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then(() => console.log("Service worker enregistré"))
      .catch((err) => console.error("Erreur SW:", err));
  });
}

// --- Sélection des éléments DOM ---
const fileInput = document.getElementById("file-input");
const scanBtn = document.getElementById("scan-mrz-btn");
const imageStatus = document.getElementById("image-status");
const mrzRawEl = document.getElementById("mrz-raw");
const docDataEl = document.getElementById("doc-data");
const nationalityInfoEl = document.getElementById("nationality-info");
const stayTypeSelect = document.getElementById("stay-type");
const purposeSelect = document.getElementById("purpose");
const assessVisaBtn = document.getElementById("assess-visa-btn");
const visaResultEl = document.getElementById("visa-result");
const rulesVersionEl = document.getElementById("rules-version");
const summaryEl = document.getElementById("summary");
const newCheckBtn = document.getElementById("new-check-btn");
const checkUpdatesBtn = document.getElementById("check-updates-btn");
const updateStatusEl = document.getElementById("update-status");
const versionInfoEl = document.getElementById("version-info");

// Caméra
const openCameraBtn = document.getElementById("open-camera-btn");
const captureBtn = document.getElementById("capture-btn");
const cameraVideo = document.getElementById("camera-video");

// Canvas d’aperçu principal
const previewCanvas = document.getElementById("preview-canvas");
const ctx = previewCanvas.getContext("2d");

// Status light MRZ
const mrzStatusLight = document.getElementById("mrz-status-light");

// --- État en mémoire (non persistant) ---
let currentImage = null;          // bool ou Image pour signaler qu’une image est dans le canvas
let currentMRZLines = null;
let currentDocumentData = null;
let currentVisaRules = null;
let currentVisaRulesVersion = null;
let cameraStream = null;

// --- Version app ---
const APP_VERSION = "1.4.0";
versionInfoEl.textContent = `Version appli : ${APP_VERSION}`;

// Utilitaire statut texte
function setStatus(el, message, level) {
  el.textContent = message;
  el.classList.remove("ok", "warn", "error");
  if (level) el.classList.add(level);
}

// Status light MRZ
function updateMrzStatusLight(doc) {
  if (!mrzStatusLight) return;

  mrzStatusLight.classList.remove(
    "status-light--ok",
    "status-light--error",
    "status-light--unknown"
  );

  if (!doc) {
    mrzStatusLight.classList.add("status-light--unknown");
    return;
  }

  const allCheckDigitsOk =
    doc.passportNumberValid &&
    doc.birthDateValid &&
    doc.expiryDateValid;

  if (allCheckDigitsOk) {
    mrzStatusLight.classList.add("status-light--ok");
  } else {
    mrzStatusLight.classList.add("status-light--error");
  }
}

// --- Gestion image via fichier ---
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  resetAfterImage();
  stopCamera(); // on coupe la caméra si elle tournait

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setStatus(imageStatus, "Veuillez sélectionner une image valide.", "error");
    scanBtn.disabled = true;
    return;
  }

  const img = new Image();
  img.onload = () => {
    const maxW = 800;
    const scale = Math.min(maxW / img.width, 1);
    previewCanvas.width = img.width * scale;
    previewCanvas.height = img.height * scale;
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
      0,
      0,
      previewCanvas.width,
      previewCanvas.height
    );
    currentImage = img;
    setStatus(imageStatus, "Image chargée. Prêt à scanner la MRZ.", "ok");
    scanBtn.disabled = false;
  };
  img.onerror = () => {
    setStatus(imageStatus, "Impossible de charger l'image.", "error");
    scanBtn.disabled = true;
  };
  img.src = URL.createObjectURL(file);
});

// --- Gestion caméra : ouverture ---
openCameraBtn.addEventListener("click", async () => {
  resetAfterImage();
  fileInput.value = "";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus(
      imageStatus,
      "Accès à la caméra non supporté par ce navigateur.",
      "error"
    );
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    cameraVideo.srcObject = cameraStream;
    cameraVideo.style.display = "block";

    setStatus(
      imageStatus,
      "Caméra active. Cadrez le document puis cliquez sur 'Prendre la photo'.",
      "ok"
    );
    captureBtn.disabled = false;
    scanBtn.disabled = true;
  } catch (err) {
    console.error(err);
    setStatus(
      imageStatus,
      "Impossible d'accéder à la caméra (permission refusée ou indisponible).",
      "error"
    );
  }
});

// --- Gestion caméra : capture ---
captureBtn.addEventListener("click", () => {
  if (!cameraStream) {
    setStatus(imageStatus, "La caméra n'est pas active.", "error");
    return;
  }

  const videoWidth = cameraVideo.videoWidth;
  const videoHeight = cameraVideo.videoHeight;

  if (!videoWidth || !videoHeight) {
    setStatus(
      imageStatus,
      "Flux vidéo non prêt. Attendez une seconde puis réessayez.",
      "warn"
    );
    return;
  }

  const maxW = 800;
  const scale = Math.min(maxW / videoWidth, 1);
  previewCanvas.width = videoWidth * scale;
  previewCanvas.height = videoHeight * scale;

  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(
    cameraVideo,
    0,
    0,
    videoWidth,
    videoHeight,
    0,
    0,
    previewCanvas.width,
    previewCanvas.height
  );

  currentImage = true;
  setStatus(
    imageStatus,
    "Photo capturée depuis la caméra. Prêt à scanner la MRZ.",
    "ok"
  );
  scanBtn.disabled = false;
});

// Couper la caméra
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraVideo.style.display = "none";
  captureBtn.disabled = true;
}

// --- Scan MRZ (recadrage bas + prétraitement + OCR) ---
scanBtn.addEventListener("click", async () => {
  if (!currentImage) return;

  setStatus(imageStatus, "Lecture MRZ en cours (OCR)...", "warn");
  scanBtn.disabled = true;
  mrzRawEl.textContent = "";
  docDataEl.innerHTML = "";
  summaryEl.innerHTML = "";
  visaResultEl.textContent = "";
  nationalityInfoEl.textContent = "";
  updateMrzStatusLight(null);

  try {
    // 1) Recadrage de la zone MRZ (bas du canvas)
    const mrzCanvas = document.createElement("canvas");
    const mrzCtx = mrzCanvas.getContext("2d");

    const cropHeight = Math.floor(previewCanvas.height * 0.25); // 25 % du bas
    mrzCanvas.width = previewCanvas.width;
    mrzCanvas.height = cropHeight;

    mrzCtx.drawImage(
      previewCanvas,
      0,
      previewCanvas.height - cropHeight,
      previewCanvas.width,
      cropHeight,
      0,
      0,
      previewCanvas.width,
      cropHeight
    );

    // 2) Prétraitement : niveaux de gris + Otsu + binarisation
    const imgData = mrzCtx.getImageData(0, 0, mrzCanvas.width, mrzCanvas.height);
    const data = imgData.data;

    // gris
    for (let i = 0; i < data.length; i += 4) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = g;
    }

    // histogramme
    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      hist[data[i]]++;
    }

    // seuil Otsu
    const threshold = otsuThreshold(hist, mrzCanvas.width * mrzCanvas.height);

    // binarisation
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] < threshold ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    mrzCtx.putImageData(imgData, 0, 0);

    // 3) OCR sur la zone MRZ prétraitée
    const { data: ocrData } = await Tesseract.recognize(mrzCanvas, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      tessedit_pageseg_mode: 6
    });

    const lines = ocrData.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let mrzCandidates = lines.filter(
      (l) => l.includes("<") && l.length >= 30 // un peu plus permissif
    );

    if (mrzCandidates.length < 2) {
      setStatus(
        imageStatus,
        "MRZ non détectée ou illisible. Vérifiez la qualité de l'image.",
        "error"
      );
      scanBtn.disabled = false;
      currentDocumentData = null;
      updateMrzStatusLight(null);
      return;
    }

    let mrzLines = mrzCandidates.slice(-2).map(normalizeMRZ);
    mrzLines = mrzLines.map((l) => l.padEnd(44, "<").slice(0, 44));
    currentMRZLines = mrzLines;

    mrzRawEl.textContent = mrzLines.join("\n");

    const parsed = parseMRZPassportTD3(mrzLines);
    currentDocumentData = parsed;

    displayDocumentData(parsed);
    updateMrzStatusLight(parsed);
    setStatus(imageStatus, "MRZ lue et parsée.", "ok");

    if (parsed.nationality) {
      nationalityInfoEl.textContent = `Nationalité MRZ : ${parsed.nationality}`;
      assessVisaBtn.disabled = true; // toujours à toi de décider si tu actives ici
      assessVisaBtn.disabled = false;
    } else {
      nationalityInfoEl.textContent =
        "Nationalité non détectée dans la MRZ.";
      assessVisaBtn.disabled = true;
    }
  } catch (err) {
    console.error(err);
    setStatus(
      imageStatus,
      "Erreur OCR lors de la lecture de la MRZ.",
      "error"
    );
    currentDocumentData = null;
    updateMrzStatusLight(null);
  } finally {
    scanBtn.disabled = false;
  }
});

// --- Otsu threshold helper ---
function otsuThreshold(hist, totalPixels) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = i;
    }
  }
  return threshold;
}

// --- Normalisation MRZ globale (corrige O/0, I/1, etc.) ---
function normalizeMRZ(text) {
  return text
    .replace(/O/g, "0")
    .replace(/Q/g, "0")
    .replace(/I/g, "1")
    .replace(/L/g, "L") // on laisse L mais on supprime les caractères non MRZ
    .replace(/B/g, "8")
    .replace(/S/g, "5")
    .replace(/[^A-Z0-9<]/g, "<");
}

// --- Parsing MRZ TD3 (passeport) ---
function parseMRZPassportTD3(lines) {
  const [l1Raw, l2Raw] = lines.map((l) => l.padEnd(44, "<").slice(0, 44));
  const l1 = l1Raw;
  const l2 = l2Raw;

  const documentType = l1.slice(0, 1);
  const issuingState = l1.slice(2, 5);
  const nameField = l1.slice(5).replace(/<+$/g, "");
  const nameParts = nameField.split("<<");
  const primaryIdentifier = nameParts[0] || "";
  const secondaryIdentifier = nameParts[1] || "";

  const rawPassNum = l2.slice(0, 9);
  const passportNumber = normalizePassportNumber(rawPassNum).replace(/</g, "");
  const passportNumberCheckDigit = l2.slice(9, 10);

  const nationality = l2.slice(10, 13);

  const rawBirth = l2.slice(13, 19);
  const rawBirthCheck = l2.slice(19, 20);

  const rawExpiry = l2.slice(21, 27);
  const rawExpiryCheck = l2.slice(27, 28);

  const birthDate = onlyDigits(rawBirth);
  const expiryDate = onlyDigits(rawExpiry);

  const birthDateCheckDigit = rawBirthCheck;
  const expiryDateCheckDigit = rawExpiryCheck;

  const sex = l2.slice(20, 21);

  const passportNumberValid = checkMRZDigit(l2.slice(0, 9), passportNumberCheckDigit);
  const birthDateValid = /^\d{6}$/.test(birthDate)
    ? checkMRZDigit(rawBirth, birthDateCheckDigit)
    : false;
  const expiryDateValid = /^\d{6}$/.test(expiryDate)
    ? checkMRZDigit(rawExpiry, expiryDateCheckDigit)
    : false;

  return {
    raw: { l1, l2 },
    documentType,
    issuingState,
    name: {
      primary: primaryIdentifier.replace(/</g, " "),
      secondary: secondaryIdentifier.replace(/</g, " ")
    },
    passportNumber,
    passportNumberValid,
    nationality,
    birthDate,
    birthDateValid,
    sex,
    expiryDate,
    expiryDateValid
  };
}

// Normalise le numéro de passeport (corrige les confusions O/0, I/1, etc.)
function normalizePassportNumber(str) {
  return str
    .replace(/O/g, "0")
    .replace(/Q/g, "0")
    .replace(/I/g, "1")
    .replace(/B/g, "8")
    .replace(/S/g, "5");
}

// Garde uniquement des chiffres (pour dates YYMMDD)
function onlyDigits(str) {
  return str.replace(/[^0-9]/g, "0");
}

// Check digit ICAO
function checkMRZDigit(data, checkDigitChar) {
  const weights = [7, 3, 1];

  const mapChar = (ch) => {
    if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - "0".charCodeAt(0);
    if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - "A".charCodeAt(0) + 10;
    if (ch === "<") return 0;
    return 0;
  };

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const val = mapChar(data[i]);
    const weight = weights[i % 3];
    sum += val * weight;
  }
  const computed = (sum % 10).toString();
  return computed === checkDigitChar;
}

// Affichage données document
function displayDocumentData(doc) {
  const expDateText = formatMRZDate(doc.expiryDate);
  const birthDateText = formatMRZDate(doc.birthDate);

  const html = `
    <div class="field"><strong>Nom (MRZ) :</strong> ${doc.name.primary}</div>
    <div class="field"><strong>Prénom(s) (MRZ) :</strong> ${doc.name.secondary}</div>
    <div class="field"><strong>Type document :</strong> ${doc.documentType}</div>
    <div class="field"><strong>Pays émetteur :</strong> ${doc.issuingState}</div>
    <div class="field"><strong>Nationalité :</strong> ${doc.nationality}</div>
    <div class="field"><strong>N° document :</strong> ${doc.passportNumber}
      (${doc.passportNumberValid ? "check digit OK" : "check digit KO"})
    </div>
    <div class="field"><strong>Date de naissance :</strong> ${birthDateText}
      (${doc.birthDateValid ? "check digit OK" : "check digit KO"})
    </div>
    <div class="field"><strong>Date d'expiration :</strong> ${expDateText}
      (${doc.expiryDateValid ? "check digit OK" : "check digit KO"})
    </div>
  `;
  docDataEl.innerHTML = html;
}

// Format date YYMMDD -> JJ/MM/AA (approx.)
function formatMRZDate(mrzDate) {
  if (!/^\d{6}$/.test(mrzDate)) return mrzDate;
  const yy = mrzDate.slice(0, 2);
  const mm = mrzDate.slice(2, 4);
  const dd = mrzDate.slice(4, 6);
  return `${dd}/${mm}/${yy}`;
}

// --- Moteur visa : chargement des règles ---
async function loadVisaRules() {
  try {
    const versionResp = await fetch("./rules/visa_rules_version.json", {
      cache: "no-cache"
    });
    const versionData = await versionResp.json();
    currentVisaRulesVersion = versionData.visa_rules_version || "inconnue";

    const rulesResp = await fetch("./rules/visa_rules.json", {
      cache: "no-cache"
    });
    const rulesData = await rulesResp.json();
    currentVisaRules = rulesData;

    rulesVersionEl.textContent = `Version règles visa locale : ${currentVisaRulesVersion}`;
  } catch (err) {
    console.error("Erreur chargement règles visa:", err);
    rulesVersionEl.textContent =
      "Impossible de charger les règles de visa locales.";
  }
}

// Évaluation visa
assessVisaBtn.addEventListener("click", () => {
  if (!currentDocumentData || !currentVisaRules) {
    setStatus(
      visaResultEl,
      "Données MRZ ou règles visa indisponibles.",
      "error"
    );
    return;
  }

  const stayType = stayTypeSelect.value;
  if (!stayType) {
    setStatus(visaResultEl, "Sélectionnez un type de séjour.", "warn");
    return;
  }

  const nationality = currentDocumentData.nationality;
  const rulesEntry = currentVisaRules[nationality];

  if (!rulesEntry) {
    setStatus(
      visaResultEl,
      `Nationalité ${nationality} non définie dans la table locale.`,
      "warn"
    );
    updateSummary("Règles visa non définies pour cette nationalité.");
    return;
  }

  let resultText = "";
  let level = "warn";

  if (stayType === "short") {
    resultText = rulesEntry.short_stay.text;
    level = rulesEntry.short_stay.level;
  } else {
    resultText = rulesEntry.long_stay.text;
    level = rulesEntry.long_stay.level;
  }

  setStatus(visaResultEl, resultText, level === "ok" ? "ok" : "warn");
  updateSummary(resultText);
});

// Résumé
function updateSummary(visaText) {
  if (!currentDocumentData) {
    summaryEl.textContent = "";
    return;
  }
  const name = `${currentDocumentData.name.primary} ${currentDocumentData.name.secondary}`;
  const nat = currentDocumentData.nationality;
  const expiry = formatMRZDate(currentDocumentData.expiryDate);

  summaryEl.innerHTML = `
    <div><strong>Identité (MRZ) :</strong> ${name}</div>
    <div><strong>Nationalité :</strong> ${nat}</div>
    <div><strong>Expiration document :</strong> ${expiry}</div>
    <div><strong>Appréciation visa :</strong> ${visaText || "N/A"}</div>
    <div class="hint">Règles utilisées : ${currentVisaRulesVersion || "inconnue"}</div>
  `;
}

// Nouveau contrôle
newCheckBtn.addEventListener("click", () => {
  fileInput.value = "";
  previewCanvas.width = 0;
  previewCanvas.height = 0;
  currentImage = null;
  currentMRZLines = null;
  currentDocumentData = null;
  mrzRawEl.textContent = "";
  docDataEl.innerHTML = "";
  nationalityInfoEl.textContent = "";
  visaResultEl.textContent = "";
  summaryEl.innerHTML = "";
  setStatus(imageStatus, "Prêt pour un nouveau contrôle.", "ok");
  scanBtn.disabled = true;
  assessVisaBtn.disabled = true;
  updateMrzStatusLight(null);
  stopCamera();
});

// Vérifier mises à jour règles visa
checkUpdatesBtn.addEventListener("click", async () => {
  updateStatusEl.textContent = "Vérification des mises à jour...";
  await loadVisaRules();
  updateStatusEl.textContent = "Règles visa rechargées.";
  setTimeout(() => (updateStatusEl.textContent = ""), 3000);
});

// Reset partiel après nouvelle image/caméra
function resetAfterImage() {
  currentMRZLines = null;
  currentDocumentData = null;
  mrzRawEl.textContent = "";
  docDataEl.innerHTML = "";
  nationalityInfoEl.textContent = "";
  visaResultEl.textContent = "";
  summaryEl.innerHTML = "";
  assessVisaBtn.disabled = true;
  updateMrzStatusLight(null);
}

// Chargement initial des règles
loadVisaRules();
