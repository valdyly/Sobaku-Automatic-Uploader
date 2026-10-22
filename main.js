const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');

let mainWindow;
let oauth2Client;

// Path File Konfigurasi & History
const configPath = path.join(app.getPath('userData'), 'sobaku-config.json');
const historyPath = path.join(app.getPath('userData'), 'sobaku-history.json');

// --- HELPER BACA/TULIS DATA AMAN ---
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error membaca config:', err);
  }
  return { 
    ytClientId: '', ytClientSecret: '',
    igAccessToken: '', igAccountId: '',
    ttAccessToken: ''
  };
}

function saveConfig(configData) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error menyimpan config:', err);
    return false;
  }
}

function getHistory() {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error membaca history:', err);
  }
  return [];
}

function saveHistoryItem(item) {
  try {
    const history = getHistory();
    history.unshift(item);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Error menyimpan history:', err);
  }
}

function getOAuth2Client() {
  const config = loadConfig();
  return new google.auth.OAuth2(
    config.ytClientId,
    config.ytClientSecret,
    'http://localhost:3000/oauth2callback'
  );
}

// --- INISIALISASI JENDELA UTAMA ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 880,
    title: "Sobaku Automatic Uploader Pro",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC HANDLERS AMAN ---
ipcMain.handle('open-file-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
  } catch (e) {
    console.error('Error open file dialog:', e);
  }
  return null;
});

ipcMain.handle('save-api-config', async (event, configData) => {
  const success = saveConfig(configData);
  return success 
    ? { status: 'success', message: 'Semua Pengaturan API Berhasil Disimpan!' }
    : { status: 'error', message: 'Gagal menyimpan konfigurasi.' };
});

ipcMain.handle('get-api-config', async () => loadConfig());
ipcMain.handle('get-history-logs', async () => getHistory());

// --- AUTENTIKASI YOUTUBE ---
ipcMain.handle('login-youtube', async () => {
  try {
    const config = loadConfig();
    if (!config.ytClientId || !config.ytClientSecret) {
      throw new Error('Client ID & Client Secret YouTube belum diisi di Pengaturan API!');
    }

    oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.upload']
    });

    shell.openExternal(authUrl);

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (req.url.startsWith('/oauth2callback')) {
            const q = url.parse(req.url, true).query;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>Login YouTube Berhasil! Anda dapat menutup halaman ini dan kembali ke aplikasi.</h2>');
            server.close();

            if (q.code) {
              const { tokens } = await oauth2Client.getToken(q.code);
              oauth2Client.setCredentials(tokens);
              resolve({ status: 'success', message: 'YouTube Berhasil Terhubung!' });
            } else {
              reject(new Error('Kode otentikasi YouTube tidak ditemukan.'));
            }
          }
        } catch (err) {
          reject(err);
        }
      }).listen(3000);
    });
  } catch (error) {
    return { status: 'error', message: `Login Gagal: ${error.message}` };
  }
});

// --- ENGINE UPLOAD PLATFORM ---

// 1. YOUTUBE UPLOADER
async function uploadToYouTube(filePath, title, description, hashtags) {
  if (!oauth2Client || !oauth2Client.credentials) {
    throw new Error('Belum Login ke Akun YouTube. Silakan klik Login YouTube di tab Pengaturan.');
  }

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const fileSize = fs.statSync(filePath).size;

  const res = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: { 
        title: title || 'New Music Video', 
        description: `${description || ''}\n\n${hashtags || ''}`, 
        categoryId: '10'
      },
      status: { privacyStatus: 'public' }
    },
    media: {
      body: fs.createReadStream(filePath)
    }
  }, {
    onUploadProgress: (evt) => {
      try {
        if (evt && evt.bytesRead && mainWindow && !mainWindow.isDestroyed()) {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          mainWindow.webContents.send('upload-progress', { platform: 'YouTube', progress });
        }
      } catch (err) {
        console.error('Progress error ignored:', err);
      }
    }
  });

  return `https://youtu.be/${res.data.id}`;
}

// 2. INSTAGRAM REELS UPLOADER
async function uploadToInstagramReels(filePath, caption, config) {
  if (!config.igAccessToken || !config.igAccountId) {
    throw new Error('Access Token atau Account ID Instagram belum dikonfigurasi.');
  }

  if (!filePath.startsWith('http://') && !filePath.startsWith('https://')) {
    throw new Error('Instagram Reels API membutuhkan file video yang di-host di URL Publik (HTTPS).');
  }

  const containerUrl = `https://graph.facebook.com/v19.0/${config.igAccountId}/media`;
  const containerRes = await axios.post(containerUrl, {
    media_type: 'REELS',
    caption: caption,
    video_url: filePath,
    access_token: config.igAccessToken
  });

  const creationId = containerRes.data.id;

  const publishUrl = `https://graph.facebook.com/v19.0/${config.igAccountId}/media_publish`;
  const publishRes = await axios.post(publishUrl, {
    creation_id: creationId,
    access_token: config.igAccessToken
  });

  return `https://instagram.com/p/${publishRes.data.id}`;
}

// 3. TIKTOK UPLOADER
async function uploadToTikTok(filePath, title, config) {
  if (!config.ttAccessToken) {
    throw new Error('Access Token TikTok API belum terdaftar.');
  }

  const initUrl = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
  const initRes = await axios.post(initUrl, {
    post_info: { title: title || 'New Video', privacy_level: 'PUBLIC_TO_EVERYONE' },
    source_info: { source: 'FILE_UPLOAD', video_size: fs.statSync(filePath).size }
  }, {
    headers: { 'Authorization': `Bearer ${config.ttAccessToken}`, 'Content-Type': 'application/json' }
  });

  return `Publish ID: ${initRes.data?.data?.publish_id || 'OK'}`;
}

// --- EXECUTION CONTROLLER ---
async function executeUploadProcess(payload) {
  const config = loadConfig();
  const logs = [];

  const fullCaption = `${payload.title}\n\n${payload.description}\n\n${payload.hashtags}`;

  // Process YouTube
  if (payload.platforms.youtube) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', 'Mengunggah ke YouTube...');
      }
      const url = await uploadToYouTube(payload.filePath, payload.title, payload.description, payload.hashtags);
      logs.push({ platform: 'YouTube', status: 'Sukses', url });
    } catch (e) {
      logs.push({ platform: 'YouTube', status: 'Gagal', error: e.message });
    }
  }

  // Process Instagram
  if (payload.platforms.instagram) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', 'Mengunggah ke Instagram Reels...');
      }
      const url = await uploadToInstagramReels(payload.filePath, fullCaption, config);
      logs.push({ platform: 'Instagram Reels', status: 'Sukses', url });
    } catch (e) {
      logs.push({ platform: 'Instagram Reels', status: 'Gagal', error: e.message });
    }
  }

  // Process TikTok
  if (payload.platforms.tiktok) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload-status', 'Mengunggah ke TikTok...');
      }
      const result = await uploadToTikTok(payload.filePath, fullCaption, config);
      logs.push({ platform: 'TikTok', status: 'Sukses', result });
    } catch (e) {
      logs.push({ platform: 'TikTok', status: 'Gagal', error: e.message });
    }
  }

  // Simpan History Log
  saveHistoryItem({
    filename: path.basename(payload.filePath),
    title: payload.title || 'Tanpa Judul',
    date: new Date().toLocaleString('id-ID'),
    details: logs
  });

  return logs;
}

ipcMain.handle('upload-video', async (event, payload) => {
  try {
    if (payload.scheduleTime) {
      const scheduleDate = new Date(payload.scheduleTime);
      const now = new Date();
      
      if (scheduleDate <= now) {
        return { status: 'error', message: 'Waktu penjadwalan harus di masa mendatang!' };
      }

      const cronTime = `${scheduleDate.getMinutes()} ${scheduleDate.getHours()} ${scheduleDate.getDate()} ${scheduleDate.getMonth() + 1} *`;
      
      cron.schedule(cronTime, async () => {
        console.log('Menjalankan unggahan otomatis terjadwal...');
        await executeUploadProcess(payload);
      });

      return { status: 'success', message: `Unggahan berhasil dijadwalkan pada: ${scheduleDate.toLocaleString('id-ID')}` };
    } else {
      const logs = await executeUploadProcess(payload);
      return { status: 'success', message: 'Proses unggah selesai!', logs };
    }
  } catch (err) {
    return { status: 'error', message: `Error Eksekusi: ${err.message}` };
  }
});