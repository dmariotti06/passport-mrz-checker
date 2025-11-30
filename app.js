// --- PWA : enregistrement du service worker ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then(() => console.log("Service worker enregistré"))
      .catch((err) => console.error("Erreur SW:", err));
  });
}

// --- Éléments DOM ---
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

// Nouveaux éléments pour la caméra
const openCameraBtn = document.getElementById("open-camera-btn");
const captureBtn = document.getElementById("capture-btn");
const cameraVideo = document.getElementById("camera-video");

const previewCanvas = document.getElementById("preview-canvas");
const ctx = previewCanvas.getContext("2d");

// --- État en mémoire (non persistant) ---
let currentImage = null;
let currentMRZLines = null;
let currentDocumentData = null;
let currentVisaRules = null;
let currentVisaRulesVersion = null;
let cameraStream = null;

// --- Version app (à adapter) ---
const APP_VERSION = "1.1.0";
versionInfoEl.textContent = `Version appli : ${APP_VERSION}`;

// --- Gestion image via fichier ---
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  resetAfterImage();
  stopCamera(); // si la caméra était active

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setStatus(imageStatus, "Veuillez sélectionner une image valide.", "error");
    scanBtn.disabled = false;
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
  fileInput.value = ""; // on ignore l'upload si la caméra est utilisée

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
      "Caméra active. Cadrez le document et cliquez sur 'Prendre la photo'.",
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

// --- Gestion caméra : capture d'une image ---
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
      "Flux vidéo non prêt. Attendez une seconde et réessayez.",
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

  currentImage = true; // flag indiquant qu'une image est disponible dans le canvas
  setStatus(
    imageStatus,
    "Photo capturée depuis la caméra. Prêt à scanner la MRZ.",
    "ok"
  );
  scanBtn.disabled = false;
});

// --- Fonction utilitaire : arrêter la caméra ---
function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraVideo.style.display = "none";
  captureBtn.disabled = true;
}

// --- Scan MRZ via Tesseract.js ---
scanBtn.addEventListener("click", async () => {
  if (!currentImage) return;
  setStatus(imageStatus, "Lecture MRZ en cours (OCR)...", "warn");
  scanBtn.disabled = true;
  mrzRawEl.textContent = "";
  docDataEl.innerHTML = "";
  summaryEl.innerHTML = "";
  visaResultEl.textContent = "";
  nationalityInfoEl.textContent = "";

  try {
    const { data } = await Tesseract.recognize(previewCanvas, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
    });

    const lines = data.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const mrzCandidates = lines.filter(
      (l) => l.includes("<") && l.length >= 40
    );
    if (mrzCandidates.length < 2) {
      setStatus(
        imageStatus,
        "MRZ non détectée ou illisible. Vérifiez le cadrage et la qualité.",
        "error"
      );
      scanBtn.disabled = false;
      return;
    }

    const mrzLines = mrzCandidates.slice(-2);
    currentMRZLines = mrzLines;
    mrzRawEl.textContent = mrzLines.join("\n");

    const parsed = parseMRZPassportTD3(mrzLines);
    currentDocumentData = parsed;

    displayDocumentData(parsed);
    setStatus(imageStatus, "MRZ lue et parsée.", "ok");

    if (parsed.nationality) {
      nationalityInfoEl.textContent = `Nationalité MRZ : ${parsed.nationality} (code pays)`;
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
      "Erreur lors de la lecture OCR. Réessayez avec une meilleure image.",
      "error"
    );
  } finally {
    scanBtn.disabled = false;
  }
});

// --- Parsing MRZ TD3 (simplifié) ---
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

  const passportNumber = l2.slice(0, 9).replace(/</g, "");
  const passportNumberCheckDigit = l2.slice(9, 10);
  const nationality = l2.slice(10, 13);
  const birthDate = l2.slice(13, 19);
  const birthDateCheckDigit = l2.slice(19, 20);
  const sex = l2.slice(20, 21);
  const expiryDate = l2.slice(21, 27);
  const expiryDateCheckDigit = l2.slice(27, 28);

  const passportNumberValid = checkMRZDigit(l2.slice(0, 9), passportNumberCheckDigit);
  const birthDateValid = checkMRZDigit(l2.slice(13, 19), birthDateCheckDigit);
  const expiryDateValid = checkMRZDigit(l2.slice(21, 27), expiryDateCheckDigit);

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

// Calcul check digit MRZ (ICAO) simplifié
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

// Conversion YYMMDD -> texte simple
function formatMRZDate(mrzDate) {
  if (!/^\d{6}$/.test(mrzDate)) return mrzDate;
  const yy = mrzDate.slice(0, 2);
  const mm = mrzDate.slice(2, 4);
  const dd = mrzDate.slice(4, 6);
  return `${dd}/${mm}/${yy}`;
}

// Utilitaire affichage statut
function setStatus(el, message, level) {
  el.textContent = message;
  el.classList.remove("ok", "warn", "error");
  if (level) el.classList.add(level);
}

// --- Moteur visa : chargement des règles locales ---
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
      "Données MRZ ou règles visas indisponibles.",
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
      `Nationalité ${nationality} non définie dans la table locale. Se référer aux instructions officielles.`,
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
  } else if (stayType === "long") {
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
    <div class="hint">Règles utilisées : ${currentVisaRulesVersion}</div>
  `;
}

// Nouveau contrôle = purge des données en mémoire
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

  stopCamera();
});

// Vérifier mises à jour (recharge règles visa)
checkUpdatesBtn.addEventListener("click", async () => {
  updateStatusEl.textContent = "Vérification des mises à jour...";
  await loadVisaRules();
  updateStatusEl.textContent = "Règles visa rechargées.";
  setTimeout(() => (updateStatusEl.textContent = ""), 3000);
});

// Réinitialisation partielle après changement d'image/caméra
function resetAfterImage() {
  currentMRZLines = null;
  currentDocumentData = null;
  mrzRawEl.textContent = "";
  docDataEl.innerHTML = "";
  nationalityInfoEl.textContent = "";
  visaResultEl.textContent = "";
  summaryEl.innerHTML = "";
  assessVisaBtn.disabled = true;
}

// Chargement initial des règles
loadVisaRules();
