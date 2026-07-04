/**
 * GIDEON-Stream-Client v4.1 // Исправленный кодек сквозного сфирального кодирования
 */

const localCanvas = document.getElementById('localCanvas');
const glLocal = localCanvas.getContext('2d');
const remoteCanvas = document.getElementById('remoteCanvas');
const glRemote = remoteCanvas.getContext('2d');
const reconImageCanvas = document.getElementById('reconstructedImageCanvas');
const glRecon = reconImageCanvas.getContext('2d');

const hiddenCanvas = document.getElementById('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d');
const localVideo = document.getElementById('localVideo');

const toggleCamBtn = document.getElementById('toggleCamBtn');
const btnPack = document.getElementById('btnPack');
const fileImport = document.getElementById('fileImport');
const netStatus = document.getElementById('netStatus');

// Габариты матрицы сканирования
const CAM_W = 80;
const CAM_H = 60;
const TOTAL_POINTS = CAM_W * CAM_H; // Ровно 4800 уникальных точек
let sTime = 0;
let isCamActive = false; 

let outgoingVoxelsPack = []; 
let lastReceivedData = null;  

const R_COIL = 1.8;
const HEIGHT_COIL = 1.2;
const HEIGHT_S = 0.4;
const S_ARC_RATIO = 0.3;

function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth; localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth; remoteCanvas.height = remoteCanvas.clientHeight;
    reconImageCanvas.width = reconImageCanvas.clientWidth; reconImageCanvas.height = reconImageCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// Управление веб-камерой
toggleCamBtn.addEventListener('click', () => {
    isCamActive = !isCamActive;
    if (isCamActive) {
        toggleCamBtn.innerText = "Выключить камеру"; toggleCamBtn.style.borderColor = "#bd00ff";
        navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120 } }).then(s => {
            localVideo.srcObject = s; localVideo.play();
        }).catch(e => { isCamActive = false; });
    } else {
        toggleCamBtn.innerText = "Включить камеру"; toggleCamBtn.style.borderColor = "#00ffcc";
        if (localVideo.srcObject) { localVideo.srcObject.getTracks().forEach(t => t.stop()); localVideo.srcObject = null; }
        localVideo.pause();
    }
});

// Кнопка запаковки
btnPack.addEventListener('click', () => {
    if (outgoingVoxelsPack.length === 0) return alert("Конвейер пуст. Включите камеру.");
    const blob = new Blob([JSON.stringify(outgoingVoxelsPack)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `gideon_correct_matrix_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    netStatus.innerText = "СТАТУС: МАТРИЦА СФИРАЛИ УСПЕШНО СОХРАНЕНА"; netStatus.style.color = "#bd00ff";
});

// Операция импорта файла
fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            lastReceivedData = JSON.parse(event.target.result);
            netStatus.innerText = "СТАТУС: ВНЕШНИЙ СИГНАЛ ПРИНЯТ. РЕГЕНЕРАЦИЯ ВЫПОЛНЕНА";
            netStatus.style.color = "#00ffcc";
        } catch(err) { alert("Ошибка файла Сфирали"); }
    };
    reader.readAsText(file);
});

// --- МАТЕМАТИЧЕСКИЙ ОПЕРАТОР СФИРАЛИ ---
function getLeftStreamPoint(t, phase) {
    let absT = Math.abs(t);
    let x = 0, y = 0, z = 0;
    const R_arc = R_COIL / 2.0;

    if (absT <= S_ARC_RATIO) {
        const localT = absT / S_ARC_RATIO;
        const phiAngle = Math.PI * (1 - localT);
        x = R_arc + R_arc * Math.cos(phiAngle);
        y = -R_arc * Math.sin(phiAngle);
        z = (HEIGHT_S / 2) * localT;
    } else {
        const localT = (absT - S_ARC_RATIO) / (1.0 - S_ARC_RATIO);
        const theta = 2 * Math.PI * localT;
        x = R_COIL * Math.cos(theta);
        y = R_COIL * Math.sin(theta);
        z = (HEIGHT_S / 2) + (HEIGHT_COIL * localT);
    }

    x = -x; y = -y; z = -z;
    const rotatedX = x * Math.cos(phase) - y * Math.sin(phase);
    const rotatedY = x * Math.sin(phase) + y * Math.cos(phase);

    return { x: rotatedX, y: rotatedY, zOffset: z, rawX: x, rawY: y };
}

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ КОНВЕЙЕР ---
function runStreamingPipeline() {
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
    glRecon.clearRect(0, 0, reconImageCanvas.width, reconImageCanvas.height);

    sTime += 0.005;

    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;
    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 3.5;
    const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 3.5;

    if (isCamActive && localVideo.readyState >= 2 && localVideo.srcObject) {
        hCtx.clearRect(0, 0, CAM_W, CAM_H);
        hCtx.drawImage(localVideo, 0, 0, CAM_W, CAM_H);
        var pixelData = hCtx.getImageData(0, 0, CAM_W, CAM_H).data;
    }

    outgoingVoxelsPack = [];

    // --- БЛОК А: ИСТИННОЕ СКВОЗНОЕ ИНДЕКСИРОВАНИЕ КАДРА ---
    // Движемся линейно от 0 до 4799. Каждая итерация — это строго ОДИН пиксель и ОДИН шаг Сфирали
    for (let i = 0; i < TOTAL_POINTS; i++) {
        // Рассчитываем плоские координаты u и v пикселя из сквозного индекса i
        let v = Math.floor(i / CAM_W);
        let u = i % CAM_W;

        // Распределяем шаг t строго от -1.0 до 0.0 без дублирования координат
        let t = (i / (TOTAL_POINTS - 1)) - 1.0;

        const voxel = getLeftStreamPoint(t, sTime);
        let r = 31, g = 119, b = 180, a = 0.2; 

        if (pixelData) {
            const idx = (v * CAM_W + u) * 4;
            r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
            r = Math.max(20, r); 
            a = (r + g + b) / 3 / 255; a = Math.max(0.15, a);
        }

        // Отрисовка исходящего диагностического витка V- в Окне 2
        if (i % 6 === 0 || pixelData) {
            const screenX = cxL + voxel.x * scaleL;
            const screenY = cyL + voxel.y * scaleL - (t * 20);
            glLocal.beginPath(); glLocal.arc(screenX, screenY, 2, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; glLocal.fill();
        }

        // Записываем воксель. Каждый пиксель теперь намертво связан со своим уникальным t
        outgoingVoxelsPack.push({ x: voxel.x, y: voxel.y, z: t, u: u, v: v, r, g, b, a });
    }

    // --- БЛОК Б: ДЕКОДИРОВАНИЕ И ПЛОТНАЯ СБОРКА РАСТРА КАРТИНКИ (ОКНО 4) ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        const rW = reconImageCanvas.width;
        const rH = reconImageCanvas.height;
        const pScaleX = rW / CAM_W;
        const pScaleY = rH / CAM_H;

        lastReceivedData.forEach((voxel, index) => {
            // Отрисовка диагностической Сфирали в нижнем Окне 3
            if (index % 8 === 0) {
                const scrLeftX = cxR + voxel.x * scaleR;
                const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 20);
                glRemote.beginPath(); glRemote.arc(scrLeftX, scrLeftY, 2, 0, 2 * Math.PI);
                glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`; glRemote.fill();

                const scrRightX = cxR + (-voxel.x) * scaleR;
                const scrRightY = cyR + (-voxel.y) * scaleR - ((-voxel.z) * 20);
                glRemote.beginPath(); glRemote.arc(scrRightX, scrRightY, 2, 0, 2 * Math.PI);
                glRemote.fillStyle = `rgba(214, 39, 40, 0.7)`; glRemote.fill();
            }

            // СБОРКА ПЛОСКОГО ЭКРАНА В ОКНЕ 4
            if (voxel.u !== undefined && voxel.v !== undefined) {
                let rectX = voxel.u * pScaleX;
                let rectY = voxel.v * pScaleY;
                
                glRecon.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
                // Отрисовываем плотный сплошной пиксель
                glRecon.fillRect(rectX, rectY, Math.ceil(pScaleX) + 1, Math.ceil(pScaleY) + 1);
            }
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
