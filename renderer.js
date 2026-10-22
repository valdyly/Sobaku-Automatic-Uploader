const { ipcRenderer } = require('electron');

const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
const uploadBtn = document.getElementById('upload-btn');
const loginYtBtn = document.getElementById('login-yt-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const statusDiv = document.getElementById('status');

const progressBox = document.getElementById('progress-box');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

const mascotImg = document.getElementById('mascot-img');
const speechBubble = document.getElementById('mascot-bubble');

let selectedFilePath = '';

// SISTEM MASKOT STAFF DINAMIS AMAN (GUARDED)
const staffCharacters = {
  idle: { img: 'IMG_4225_1.png', text: 'Siap bantu upload video karya kamu hari ini! ✨' },
  fileSelected: { img: 'IMG_4233.png', text: 'File video sudah terpilih! Tinggal lengkapi judul dan deskripsinya ya.' },
  uploading: { img: 'IMG_4224_1.png', text: 'Sedang memproses unggahan... Mohon jangan tutup aplikasinya ya!' },
  success: { img: 'IMG_4227_1.png', text: 'Hore! Video kamu berhasil terunggah ke platform! 🎉' },
  configTab: { img: 'IMG_4228_1.png', text: 'Jangan lupa periksa dan simpan Kredensial API kamu di sini ya.' }
};

function updateMascot(state) {
  if (mascotImg && speechBubble && staffCharacters[state]) {
    mascotImg.src = staffCharacters[state].img;
    speechBubble.innerText = staffCharacters[state].text;
  }
}

// Tab Switcher
window.switchTab = function(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');
  if (window.event && window.event.currentTarget) window.event.currentTarget.classList.add('active');

  if (tabId === 'config-tab') {
    updateMascot('configTab');
  } else if (tabId === 'upload-tab') {
    selectedFilePath ? updateMascot('fileSelected') : updateMascot('idle');
  } else if (tabId === 'history-tab') {
    loadHistory();
  }
};

// Initial Load
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const config = await ipcRenderer.invoke('get-api-config');
    if (config) {
      if (config.ytClientId) document.getElementById('api-yt-client-id').value = config.ytClientId;
      if (config.ytClientSecret) document.getElementById('api-yt-client-secret').value = config.ytClientSecret;
      if (config.igAccessToken) document.getElementById('api-ig-access-token').value = config.igAccessToken;
      if (config.igAccountId) document.getElementById('api-ig-account-id').value = config.igAccountId;
      if (config.ttAccessToken) document.getElementById('api-tt-access-token').value = config.ttAccessToken;
    }
  } catch (e) {
    console.error("Error loading config:", e);
  }
});

// File Dialog Picker
if (dropZone) {
  dropZone.addEventListener('click', async () => {
    try {
      const filePath = await ipcRenderer.invoke('open-file-dialog');
      if (filePath) {
        selectedFilePath = filePath;
        const fileName = filePath.split('\\').pop().split('/').pop();
        if (fileInfo) fileInfo.innerText = `File Terpilih: ${fileName}`;
        updateMascot('fileSelected');
      }
    } catch (e) {
      console.error("Error picking file:", e);
    }
  });
}

// Progress Bar Listener
ipcRenderer.on('upload-progress', (event, data) => {
  if (progressBox && progressBar && progressText) {
    progressBox.style.display = 'block';
    progressBar.style.width = `${data.progress}%`;
    progressText.innerText = `${data.platform}: ${data.progress}%`;
  }
});

ipcRenderer.on('upload-status', (event, message) => {
  if (statusDiv) statusDiv.innerText = message;
});

// Save Config
if (saveConfigBtn) {
  saveConfigBtn.addEventListener('click', async () => {
    const payload = {
      ytClientId: document.getElementById('api-yt-client-id').value.trim(),
      ytClientSecret: document.getElementById('api-yt-client-secret').value.trim(),
      igAccessToken: document.getElementById('api-ig-access-token').value.trim(),
      igAccountId: document.getElementById('api-ig-account-id').value.trim(),
      ttAccessToken: document.getElementById('api-tt-access-token').value.trim()
    };

    const res = await ipcRenderer.invoke('save-api-config', payload);
    alert(res.message);
  });
}

// YouTube Auth
if (loginYtBtn) {
  loginYtBtn.addEventListener('click', async () => {
    if (statusDiv) statusDiv.innerText = 'Membuka halaman autentikasi browser...';
    const res = await ipcRenderer.invoke('login-youtube');
    alert(res.message);
    if (statusDiv) statusDiv.innerText = res.message;
  });
}

// Upload Trigger
if (uploadBtn) {
  uploadBtn.addEventListener('click', async () => {
    if (!selectedFilePath) {
      alert('Harap pilih file video terlebih dahulu!');
      return;
    }

    const payload = {
      filePath: selectedFilePath,
      title: document.getElementById('title').value,
      description: document.getElementById('description').value,
      hashtags: document.getElementById('hashtags').value,
      scheduleTime: document.getElementById('schedule-time').value,
      platforms: {
        youtube: document.getElementById('yt').checked,
        instagram: document.getElementById('ig').checked,
        tiktok: document.getElementById('tt').checked
      }
    };

    updateMascot('uploading');
    if (statusDiv) statusDiv.innerText = 'Memproses unggahan... Silakan tunggu.';
    
    try {
      const res = await ipcRenderer.invoke('upload-video', payload);
      if (statusDiv) statusDiv.innerText = res.message;

      if (res.status === 'success') {
        updateMascot('success');
      }

      if (res.logs && statusDiv) {
        let detailText = '\n\nHasil Unggahan:\n';
        res.logs.forEach(log => {
          detailText += `- ${log.platform}: ${log.status} ${log.url ? `(${log.url})` : ''} ${log.error ? `(${log.error})` : ''}\n`;
        });
        statusDiv.innerText += detailText;
      }
    } catch (err) {
      if (statusDiv) statusDiv.innerText = `Gagal memproses: ${err.message}`;
    }
  });
}

// History Loader
async function loadHistory() {
  try {
    const history = await ipcRenderer.invoke('get-history-logs');
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: #94a3b8;">Belum ada riwayat unggahan.</td></tr>';
      return;
    }

    history.forEach(item => {
      let platformDetails = item.details ? item.details.map(d => `${d.platform}: ${d.status}`).join('<br>') : '-';
      const row = `
        <tr>
          <td>${item.date}</td>
          <td>${item.filename}</td>
          <td>${item.title}</td>
          <td>${platformDetails}</td>
        </tr>
      `;
      tbody.innerHTML += row;
    });
  } catch (e) {
    console.error("Error loading history:", e);
  }
}