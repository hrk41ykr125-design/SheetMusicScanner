// --- DOM要素の取得 ---
const video = document.getElementById('camera-preview');
const startCameraBtn = document.getElementById('start-camera-btn');
const captureBtn = document.getElementById('capture-btn');
const fileInput = document.getElementById('file-input');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const resultSection = document.getElementById('result-section');
const resultTitle = document.getElementById('result-title');
const resultComposer = document.getElementById('result-composer');
const resultDesc = document.getElementById('result-desc');
const gasStatusText = document.getElementById('gas-status-text');

const apiKeyInput = document.getElementById('gemini-api-key');
const gasUrlInput = document.getElementById('gas-url');
const spreadsheetUrlInput = document.getElementById('spreadsheet-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const viewSpreadsheetBtn = document.getElementById('view-spreadsheet-btn');

let stream = null;

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    // ローカルストレージからAPIキー等の設定を復元
    const savedApiKey = localStorage.getItem('music_scanner_gemini_key');
    const savedGasUrl = localStorage.getItem('music_scanner_gas_url');
    const savedSheetUrl = localStorage.getItem('music_scanner_spreadsheet_url');
    if (savedApiKey) apiKeyInput.value = savedApiKey;
    if (savedGasUrl) gasUrlInput.value = savedGasUrl;
    if (savedSheetUrl) spreadsheetUrlInput.value = savedSheetUrl;
});

// 設定保存
saveSettingsBtn.addEventListener('click', () => {
    localStorage.setItem('music_scanner_gemini_key', apiKeyInput.value.trim());
    localStorage.setItem('music_scanner_gas_url', gasUrlInput.value.trim());
    localStorage.setItem('music_scanner_spreadsheet_url', spreadsheetUrlInput.value.trim());
    showToast('設定をデバイスに保存しました', 'success');
});

// スプレッドシートを表示
viewSpreadsheetBtn.addEventListener('click', () => {
    const url = spreadsheetUrlInput.value.trim();
    if (url) {
        window.open(url, '_blank');
    } else {
        showToast('スプレッドシートURLが設定されていません', 'error');
    }
});

// --- カメラ制御 ---
startCameraBtn.addEventListener('click', async () => {
    try {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        // 外カメラを優先的に起動
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        video.srcObject = stream;
        captureBtn.disabled = false;
        resultSection.classList.add('hidden');
        showToast('カメラを起動しました', 'info');
    } catch (err) {
        console.error("Camera Error:", err);
        showToast('カメラへのアクセスが拒否されたか、利用できません。ファイル選択をお試しください。', 'error');
    }
});

// ファイル選択からの取得（フォールバック）
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        // 画像が巨大だとAPI制限・タイムアウトに引っかかるためリサイズする
        resizeImageAndProcess(event.target.result);
    };
    reader.readAsDataURL(file);
    resultSection.classList.add('hidden');
    fileInput.value = ''; // 連続で同じファイルを選べるようにリセット
});

// ライブカメラからのスキャンボタン
captureBtn.addEventListener('click', () => {
    if (!video.videoWidth) {
        showToast('カメラの準備ができていません', 'error');
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    resizeImageAndProcess(dataUrl);
});

// --- 画像のリサイズとメイン処理開始 ---
function resizeImageAndProcess(dataUrl) {
    const img = new Image();
    img.onload = () => {
        const MAX_WIDTH = 1200; // API制限回避のため幅を最大1200pxに圧縮
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
            height = Math.floor(height * (MAX_WIDTH / width));
            width = MAX_WIDTH;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Base64のプレフィックスを削除して抽出
        const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        processImage(base64Data);
    };
    img.onerror = () => {
        showToast('画像の読み込みに失敗しました', 'error');
    };
    img.src = dataUrl;
}

// --- メインフロー処理 ---
async function processImage(base64Data) {
    const apiKey = apiKeyInput.value.trim();
    const gasUrl = gasUrlInput.value.trim();

    if (!apiKey) return showToast('Gemini APIキーを設定してください', 'error');
    if (!gasUrl) return showToast('GAS URLを設定してください', 'error');

    // UIを初期化・ローディング状態に
    captureBtn.disabled = true;
    loadingOverlay.classList.remove('hidden');
    resultSection.classList.add('hidden');

    try {
        // [Step 1] Gemini API への画像送信・解析
        updateLoadingText('AIで楽譜を解析中...');
        const musicInfo = await extractMusicInfoWithGemini(base64Data, apiKey);

        // 読み取り失敗時のバリデーション
        if (!musicInfo.title || musicInfo.title.includes("不明") || musicInfo.title === "") {
            throw new Error("タイトルが読み取れませんでした。ピントを合わせて再撮影してください。");
        }

        // 解析成功時のUI表示
        resultTitle.textContent = musicInfo.title;
        resultComposer.textContent = musicInfo.composer || '不明';
        resultDesc.textContent = musicInfo.description || '情報なし';

        gasStatusText.textContent = 'スプレッドシートへ書き込み中...';
        gasStatusText.className = 'text-sm border p-2 rounded-md text-center font-bold text-yellow-600 border-yellow-200 bg-yellow-50 animate-pulse';
        resultSection.classList.remove('hidden');

        // [Step 2] GAS経由でスプレッドシートに保存
        updateLoadingText('データ保存中...');
        const payloadToGas = {
            ...musicInfo,
            sheetUrl: spreadsheetUrlInput.value.trim()
        };
        await saveToSpreadsheet(payloadToGas, gasUrl);

        // 保存成功時の表示
        gasStatusText.innerHTML = '<i class="fa-solid fa-cloud-arrow-up mr-1 text-lg"></i>完了：スプレッドシートに保存しました';
        gasStatusText.className = 'text-sm border p-2 rounded-md text-center font-bold text-emerald-700 border-emerald-200 bg-emerald-50';
        showToast('全ての処理が完了しました', 'success');

    } catch (err) {
        console.error("Processing Error:", err);
        showToast(err.message || '予期せぬエラーが発生しました', 'error');
        gasStatusText.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-1"></i>書き込み失敗';
        gasStatusText.className = 'text-sm border p-2 rounded-md text-center font-bold text-red-600 border-red-200 bg-red-50';
    } finally {
        loadingOverlay.classList.add('hidden');
        captureBtn.disabled = (video.srcObject === null);
    }
}

// --- AI連携: Gemini API 通信 ---
async function extractMusicInfoWithGemini(base64Image, apiKey) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    // AIへのプロンプト指示
    const prompt = `この画像は楽譜の1ページ目です。画像から楽譜の題名（タイトル）を読み取ってください。
また、その曲の「作曲者」と「楽曲の一般的な概要や背景情報（150文字程度）」をインターネット上の知識から補完し、必ず以下の形式のJSONのみで出力してください。
Markdownのバッククォート( \`\`\`json )等は絶対に含めず、純粋なJSONテキストのみを返却してください。
{
  "title": "曲名（読み取れない場合は'不明'）",
  "composer": "作曲者名（不明な場合は'不明'）",
  "description": "楽曲の概要・情報"
}`;

    const payload = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: "image/jpeg", data: base64Image } }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.2, // 創造性より正確性を重視
            responseMimeType: "application/json" // JSON形式での返却を強制
        }
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API Error:', response.status, errorText);
        throw new Error(`AIの通信エラーです (${response.status})。APIキーや設定を確認してください。`);
    }

    const data = await response.json();
    try {
        const textContent = data.candidates[0].content.parts[0].text;
        // APIが強制的にJSONブロック化(markdown)してしまう場合に対する防御的処理
        const cleanJson = textContent.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        console.error("Parse Error:", e, data);
        throw new Error('AIから不正なデータが返却されました。別の角度から撮影してください。');
    }
}

// --- DB連携: Google Apps Script API 通信 ---
async function saveToSpreadsheet(musicInfo, gasUrl) {
    // 【重要】ブラウザのCORSプリフライト(OPTIONSリクエスト)を回避するため、
    // Content-Typeを 'text/plain' にして送信することがGAS WebAppのベストプラクティス。
    const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(musicInfo)
    });

    // 内部的にはGAS側でリダイレクトされた後の200 OKが返る
    if (!response.ok) {
        throw new Error('GASへの通信に失敗しました。Webアプリ設定とURLを確認してください。');
    }

    const result = await response.json().catch(() => ({ status: 'unknown' }));
    if (result.status === 'error') {
        throw new Error('シートへの追記中にエラー: ' + result.message);
    }
    return result;
}

// --- UIヘルパー関数 (トースト通知等) ---
function updateLoadingText(text) {
    loadingText.textContent = text;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    toastMessage.textContent = message;
    toast.className = 'fixed bottom-5 left-1/2 transform -translate-x-1/2 px-5 py-3 rounded-full shadow-2xl transition-all duration-300 pointer-events-none z-50 flex items-center min-w-[250px] justify-center text-white text-sm';
    toastIcon.className = 'mr-2 fa-solid text-lg';

    if (type === 'success') {
        toast.classList.add('bg-emerald-600');
        toastIcon.classList.add('fa-check-circle');
    } else if (type === 'error') {
        toast.classList.add('bg-red-600');
        toastIcon.classList.add('fa-triangle-exclamation');
    } else {
        toast.classList.add('bg-indigo-600');
        toastIcon.classList.add('fa-info-circle');
    }

    toast.classList.add('toast-show');
    // 3.5秒後に自動で非表示
    setTimeout(() => {
        toast.classList.remove('toast-show');
    }, 3500);
}
