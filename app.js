/**
 * GIDEON-Stream-Client // Сетевой координатор через встроенное Telegram WebApp API
 */

const localCanvas = document.getElementById('localCanvas');
const glLocal = localCanvas.getContext('2d');
const remoteCanvas = document.getElementById('remoteCanvas');
const glRemote = remoteCanvas.getContext('2d');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d');
const localVideo = document.getElementById('localVideo');

const myIdDisplay = document.getElementById('myId');
const peerIdInput = document.getElementById('peerIdInput');
const btnConnect = document.getElementById('btnConnect');
const netStatus = document.getElementById('netStatus');

const modeLoopBtn = document.getElementById('modeLoopBtn');
const modeNetBtn = document.getElementById('modeNetBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const networkBlock = document.getElementById('networkBlock');

const DENSITY = 350; 
let sTime = 0, isCamActive = false, signalMode = 'loop'; 
let myChatId = "LOCAL_USER", targetChatId = null, lastReceivedData = null;

// Инициализируем контекст Telegram WebApp
let tg = null;
if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand(); // Разворачиваем окно на весь экран телефона
    
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        myChatId = tg.initDataUnsafe.user.id.toString();
    }
}

toggleCamBtn.innerText = "Включить камеру";
toggleCamBtn.style.borderColor = "#00ffcc";
myIdDisplay.innerText = myChatId;
netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (МАТЕМАТИЧЕСКИЙ ТЕСТ)";

function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth; localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth; remoteCanvas.height = remoteCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

modeLoopBtn.addEventListener('click', () => {
    signalMode = 'loop';
    modeLoopBtn.classList.add('active'); modeNetBtn.classList.remove('active');
    networkBlock.style.display = 'none';
    netStatus.innerText = isCamActive ? "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (СЕНСОР)" : "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (МАТЕМАТИЧЕСКИЙ ТЕСТ)";
    netStatus.style.color = "#00ffcc";
});

modeNetBtn.addEventListener('click', () => {
    signalMode = 'network';
    modeNetBtn.classList.add('active'); modeLoopBtn.classList.remove('active');
    networkBlock.style.display = 'block';
    netStatus.innerText = "СТАТУС: TELEGRAM WEBAPP СВЯЗЬ АКТИВНА"; 
    netStatus.style.color = "#bd00ff";
});

toggleCamBtn.addEventListener('click', () => {
    isCamActive = !isCamActive;
    if (isCamActive) {
        toggleCamBtn.innerText = "Выключить камеру"; toggleCamBtn.style.borderColor = "#bd00ff";
        navigator.mediaDevices.getUserMedia({ video: { width: 80, height: 60 } }).then(s => { localVideo.srcObject = s; localVideo.play(); if (signalMode === 'loop') netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (СЕНСОР)"; }).catch(e => { isCamActive = false; toggleCamBtn.innerText = "Включить камеру"; toggleCamBtn.style.borderColor = "#00ffcc"; });
    } else {
        toggleCamBtn.innerText = "Включить камеру"; toggleCamBtn.style.borderColor = "#00ffcc";
        if (localVideo.srcObject) { localVideo.srcObject.getTracks().forEach(t => t.stop()); localVideo.srcObject = null; }
        localVideo.pause(); if (signalMode === 'loop') netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (МАТЕМАТИЧЕСКИЙ ТЕСТ)";
    }
});

// Отправка вокселей через встроенную шину данных Telegram WebApp
function sendSfiralDataViaTG(voxelsPack) {
    if (!tg) return;
    
    const payload = {
        type: "gideon_v-",
        from: myChatId,
        v: voxelsPack.map(pt => [Math.round(pt.x*100), Math.round(pt.y*100), Math.round(pt.z*100), pt.r, pt.g, pt.b])
    };

    // Передаем данные обратно в чат бота абсолютно легально и без блокировок CORS
    tg.sendData(JSON.stringify(payload));
}

btnConnect.addEventListener('click', () => {
    const inputVal = peerIdInput.value.trim();
    if (!inputVal) return alert("Введите ID абонента");
    targetChatId = inputVal; 
    netStatus.innerText = `СТАТУС: ПЕРЕДАЧА ДАННЫХ В ЧАТ TELEGRAM`; 
    netStatus.style.color = "#bd00ff";
});

let frameThrottle = 0;
function runStreamingPipeline() {
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height); glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
    sTime += 0.006;
    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;
    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 4; const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 4;

    let pixelData = null;
    if (isCamActive && localVideo.readyState >= 2 && localVideo.srcObject) {
        hCtx.clearRect(0, 0, 80, 60); hCtx.drawImage(localVideo, 0, 0, 80, 60); pixelData = hCtx.getImageData(0, 0, 80, 60).data;
    }

    let outgoingVoxelsPack = [];
    const currentR = SfiralP2P.R_coil || 1.8;

    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; 
        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);
        const screenX = cxL + leftVoxel.x * scaleL; const screenY = cyL + leftVoxel.y * scaleL - (t * 40);
        let r = 31, g = 119, b = 180, a = 0.85; 

        if (pixelData) {
            let u = Math.floor(((currentR - leftVoxel.x) / (currentR * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + currentR) / (currentR * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));
            const idx = (v * 80 + u) * 4; r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2]; a = (r + g + b) / 3 / 255;
        }

        if (a > 0.08) {
            glLocal.beginPath(); glLocal.arc(screenX, screenY, 3.5, 0, 2 * Math.PI); glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; glLocal.fill();
            outgoingVoxelsPack.push({ x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b, a });
        }
    }

    if (signalMode === 'loop') {
        lastReceivedData = outgoingVoxelsPack;
    } else if (signalMode === 'network' && outgoingVoxelsPack.length > 0) {
        frameThrottle++; 
        if (frameThrottle >= 60) { // Отправляем пакет при фиксации кадра кнопкой
            sendSfiralDataViaTG(outgoingVoxelsPack); 
            frameThrottle = 0; 
        }
    }

    if (lastReceivedData && lastReceivedData.length > 0) {
        lastReceivedData.forEach(voxel => {
            const scrLeftX = cxR + voxel.x * scaleR; const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 40);
            glRemote.beginPath(); glRemote.arc(scrLeftX, scrLeftY, 3.5, 0, 2 * Math.PI); glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`; glRemote.fill();

            const rightVoxel = SfiralP2P.reconstructRightVoxel({ x: voxel.x, y: voxel.y, zOffset: voxel.z });
            const scrRightX = cxR + rightVoxel.x * scaleR; const scrRightY = cyR + rightVoxel.y * scaleR - ((-voxel.z) * 40); 
            glRemote.beginPath(); glRemote.arc(scrRightX, scrRightY, 3.5, 0, 2 * Math.PI); glRemote.fillStyle = `rgba(214, 39, 40, ${voxel.a})`; glRemote.fill();
        });
    }
    requestAnimationFrame(runStreamingPipeline);
}
runStreamingPipeline();
