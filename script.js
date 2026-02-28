// --- DOM要素の取得 ---
const video = document.getElementById('camera-preview');
const startCameraBtn = document.getElementById('start-camera-btn');
const captureBtn = document.getElementById('capture-btn');
const fileInput = document.getElementById('file-input');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const resultSection = document.getElementById('result-section');
const resultTitle = document.getElementById('result-title');
const resultArtist = document.getElementById('result-artist');
const resultCategory = document.getElementById('result-category');
const resultComposer = document.getElementById('result-composer');
const resultDesc = document.getElementById('result-desc');
const gasStatusText = document.getElementById('gas-status-text');

const apiKeyInput = document.getElementById('gemini-api-key');
const modelInput = document.getElementById('gemini-model');
const fetchModelsBtn = document.getElementById('fetch-models-btn');
const gasUrlInput = document.getElementById('gas-url');
const spreadsheetUrlInput = document.getElementById('spreadsheet-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const testGasBtn = document.getElementById('test-gas-btn');
const viewSpreadsheetBtn = document.getElementById('view-spreadsheet-btn');

let stream = null;

// デフォルト設定 (埋め込み用)
const DEFAULT_GEMINI_API_KEY = "AIzaSyBhC3tO4dY_cO57q40Ah7BpiPVdMIcA4fc";
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash-latest";
const DEFAULT_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1NNV2TGR2bBqBFYFraGeIiG5Lnk7nOSmc0x1J3V1jUMA/edit?gid=0#gid=0";

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    // ローカルストレージから復元、なければ埋め込みデフォルトを表示
    const savedApiKey = localStorage.getItem('music_scanner_gemini_key');
    const savedModel = localStorage.getItem('music_scanner_gemini_model');
    const savedGasUrl = localStorage.getItem('music_scanner_gas_url');
    const savedSheetUrl = localStorage.getItem('music_scanner_spreadsheet_url');

    apiKeyInput.value = savedApiKey || DEFAULT_GEMINI_API_KEY;
    modelInput.value = savedModel || DEFAULT_GEMINI_MODEL;
    if (savedGasUrl) gasUrlInput.value = savedGasUrl;
    spreadsheetUrlInput.value = savedSheetUrl || DEFAULT_SPREADSHEET_URL;

    // スプレッドシートを表示ボタンの初期有効化
    updateViewSpreadsheetBtn();
});

function updateViewSpreadsheetBtn() {
    if (spreadsheetUrlInput.value.trim()) {
        viewSpreadsheetBtn.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        viewSpreadsheetBtn.classList.add('opacity-50', 'pointer-events-none');
    }
}

// 入力時にボタンの状態を更新
spreadsheetUrlInput.addEventListener('input', updateViewSpreadsheetBtn);

// 設定保存
saveSettingsBtn.addEventListener('click', () => {
    localStorage.setItem('music_scanner_gemini_key', apiKeyInput.value.trim());
    localStorage.setItem('music_scanner_gemini_model', modelInput.value.trim());
    localStorage.setItem('music_scanner_gas_url', gasUrlInput.value.trim());
    localStorage.setItem('music_scanner_spreadsheet_url', spreadsheetUrlInput.value.trim());
    showToast('設定をデバイスに保存しました', 'success');
});

// スプレッドシートを表示
viewSpreadsheetBtn.addEventListener('click', () => {
    const url = spreadsheetUrlInput.value.trim() || DEFAULT_SPREADSHEET_URL;
    if (url) {
        window.open(url, '_blank');
    } else {
        showToast('スプレッドシートURLが設定されていません', 'error');
    }
});

// GAS接続テスト
testGasBtn.addEventListener('click', async () => {
    const gasUrl = gasUrlInput.value.trim();
    if (!gasUrl) return showToast('GAS URLを入力してください', 'error');

    showToast('GAS接続テスト中...', 'info');
    try {
        const response = await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                title: "TEST",
                composer: "DEBUG",
                description: "Connection test",
                sheetUrl: spreadsheetUrlInput.value.trim() || DEFAULT_SPREADSHEET_URL
            })
        });
        const text = await response.text();
        if (text.includes('Sign in - Google Accounts')) {
            throw new Error("Googleログイン画面が返されました。「アクセスできるユーザー」を「全員」にしてください。");
        }
        const res = JSON.parse(text);
        if (res.status === 'success') {
            showToast('GAS接続成功！スプレッドシートを確認してください', 'success');
        } else {
            throw new Error(res.message);
        }
    } catch (e) {
        showToast('GAS接続失敗: ' + e.message, 'error');
        console.error(e);
    }
});

// --- Geminiモデル一覧の動的取得 ---
fetchModelsBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) return showToast('先にAPIキーを入力してください', 'error');

    showToast('利用可能なモデルを取得中...', 'info');
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
            let errMessage = `HTTP ${response.status}`;
            try {
                const errData = await response.json();
                if (errData.error && errData.error.message) errMessage = errData.error.message;
            } catch (e) { }
            throw new Error(errMessage);
        }

        const data = await response.json();
        // 画像生成(generateContent)をサポートしているモデルをフィルタ
        const supportedModels = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));

        if (supportedModels.length === 0) throw new Error('対応モデルが見つかりません');

        // 現在の選択を記憶
        const currentVal = modelInput.value;

        // 取得したモデルでプルダウンを再構築
        modelInput.innerHTML = '';
        supportedModels.forEach(m => {
            const cleanName = m.name.replace('models/', '');
            const option = document.createElement('option');
            option.value = cleanName;
            // flashという文字が含まれていればおすすめ表示
            option.textContent = cleanName + (cleanName.includes('flash') ? ' (おすすめ)' : '');
            modelInput.appendChild(option);
        });

        // 以前の選択があれば復元
        if (Array.from(modelInput.options).some(o => o.value === currentVal)) {
            modelInput.value = currentVal;
        } else {
            // なければ flash系の最新を優先選択
            const flashOpt = Array.from(modelInput.options).find(o => o.value.includes('flash'));
            if (flashOpt) modelInput.value = flashOpt.value;
        }

        showToast(`${supportedModels.length}件のモデルを取得しました`, 'success');
    } catch (e) {
        showToast('モデル取得に失敗: ' + e.message, 'error');
        console.error(e);
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
    const modelName = modelInput.value.trim() || DEFAULT_GEMINI_MODEL;
    const gasUrl = gasUrlInput.value.trim();

    if (!apiKey) return showToast('Gemini APIキーを設定してください', 'error');
    if (!gasUrl) return showToast('GAS URLを設定してください', 'error');

    // UIを初期化・ローディング状態に
    captureBtn.disabled = true;
    loadingOverlay.classList.remove('hidden');
    resultSection.classList.add('hidden');

    try {
        // [Step 1] Gemini API への画像送信・解析
        updateLoadingText(`AI(${modelName})で楽譜を解析中...`);
        const musicInfo = await extractMusicInfoWithGemini(base64Data, apiKey, modelName);

        // 読み取り失敗時のバリデーション
        if (!musicInfo.title || musicInfo.title.includes("不明") || musicInfo.title === "") {
            throw new Error("タイトルが読み取れませんでした。ピントを合わせて再撮影してください。");
        }

        // 解析成功時のUI表示
        resultTitle.textContent = musicInfo.title;
        resultArtist.textContent = musicInfo.artist || '不明';
        resultCategory.textContent = musicInfo.category || 'その他';
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
async function extractMusicInfoWithGemini(base64Image, apiKey, modelName) {
    // モデル名をクリーンアップ。万が一間違ったフルネーム（例: models/gemini...）が入っていても取り除く
    let cleanModelName = modelName.replace(/^models\//, '').trim();

    // 現在推奨されている1.5 Flashのエイリアス
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent?key=${apiKey}`;

    // AIへのプロンプト指示
    const prompt = `この画像は楽譜の1ページ目です。画像から楽譜の情報を読み取り、インターネット上の知識で補完して以下のJSON形式で出力してください。

1. title: 曲名（読み取れない場合は'不明'）
2. artist: アーティスト名。バンド名や演奏者を必ず登録してください。
3. category: 楽曲の分類。必ず以下のリストから最も適切なものを1つだけ選んでください。該当がない場合は「その他」にしてください。
   [連弾, ドラマ, クラシック, 子供, CM, メンズ, 映画, アニメ, レディース, 洋楽・インスト, 無印, その他, ジャズ・ラテン, 童謡]
4. composer: 作曲者名（不明な場合は'不明'）
5. description: 楽曲の一般的な概要や背景情報（150文字程度）

Markdownのバッククォート等は含めず、純粋なJSONテキストのみを返却してください。
{
  "title": "...",
  "artist": "...",
  "category": "...",
  "composer": "...",
  "description": "..."
}`;

    const payload = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/jpeg", data: base64Image } }
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
        let errorMsg = `HTTP Error ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData.error && errorData.error.message) {
                errorMsg = errorData.error.message;
            }
        } catch (e) {
            errorMsg = await response.text();
        }
        console.error('Gemini API Error:', response.status, errorMsg);
        throw new Error(`AI通信エラー (${response.status}): ${errorMsg}`);
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
    // 【超重要】GASのCORS回避策:
    // fetchで JSON を POST すると OPTIONS(プリフライト) が発生してCORSエラーになることが多い。
    // application/x-www-form-urlencoded または text/plain で送信し、かつ mode: 'no-cors' を使うのが確実です。
    // 今回は確実に発火させるため、JSON文字列にして送信します。
    const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(musicInfo)
    });

    // --- ここが重要 ---
    // Google Apps Scriptによる「全員アクセス可能」なWebアプリは、裏でリダイレクトをはさみます。
    // fetch で 'no-cors' を指定しない場合、このリダイレクトでCORSエラーとして遮断されるか、
    // あるいは(設定ミス等で)GoogleのログインHTMLが返却されてしまいます。
    // 今回は text/plain で送っているため、response.text() が正常に返るはずですが、
    // HTML(ログイン画面)が返った場合は設定ミス(Execute as: User accessing the web appになっている)です。
    if (!response.ok) {
        throw new Error('GASへの通信に失敗しました。Webアプリ設定とURLを確認してください。');
    }

    try {
        const text = await response.text();

        // GoogleログインのHTMLが返ってきた場合はデプロイ設定ミス
        if (text.includes('Sign in - Google Accounts') || text.includes('accounts.google.com') || text.trim().startsWith('<html') || text.trim().startsWith('<!DOCTYPE html>')) {
            throw new Error("【設定エラー】GASのデプロイ時に「アクセスできるユーザー」が「全員」になっていません、または「実行するユーザー」が「自分」になっていません。設定をやり直してください。");
        }

        const result = JSON.parse(text);
        if (result.status === 'error') {
            throw new Error('シートへの追記中にエラー: ' + result.message);
        }
        return result;
    } catch (e) {
        console.error("GAS Parse Error or Invalid Response:", e);
        // エラーメッセージをそのまま表示
        if (e.message.includes('【設定エラー】') || e.message.includes('シートへの追記中')) {
            throw e;
        }
        throw new Error('スプレッドシートへの保存に失敗しました。詳細: ' + e.message);
    }
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
