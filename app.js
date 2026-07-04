/**
 * GIDEON-Stream-Client v4.2 // Честный попиксельный асимметричный кодек
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

// Габариты матрицы сканирования кадра
const CAM_W = 80;
const CAM_H = 60;
let sTime = 0;
let isCamActive = false; 

let outgoingVoxelsPack = []; 
let lastReceivedData = null;  

// Константы оригинальной Сфирали автора
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
    a.download = `gideon_asymmetric_matrix_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    netStatus.innerText = "СТАТУС: ФАЙЛ МАТРИЦЫ УСПЕШНО СОХРАНЕН"; netStatus.style.color = "#bd00ff";
});

// Операция импорта файла
fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0]; // Исправлен индекс для жесткого перехвата первого файла
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            lastReceivedData = JSON.parse(event.target.result);
            netStatus.innerText = "СТАТУС: ВНЕШНИЙ СИГНАЛ ПРИНЯТ. РЕГЕНЕРАЦИЯ КАДРА ВЫПОЛНЕНА";
            netStatus.style.color = "#00ffcc";
        } catch(err) { alert("Ошибка чтения файла Сфирали"); }
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

    return { x: rotatedX, y: rotatedY, zOffset: z };
}

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ И РЕКОНСТРУКЦИОННЫЙ КОНВЕЙЕР ---
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
    let diagnosticCounter = 0;

    // --- БЛОК А: ИСТИННОЕ ПОПИКСЕЛЬНОЕ СКАНИРОВАНИЕ КАДРА ---
    // Движемся строго по строкам (v) и столбцам (u) прямоугольной сетки
    for (let v = 0; v < CAM_H; v++) {
        for (let u = 0; u < CAM_W; u++) {
            diagnosticCounter++;
            
            // Распределяем шаг t строго от -1.0 до 0.0 пропорционально ходу луча по кадру
            let t = -1.0 + (v / (CAM_H - 1)) * 0.5 + (u / (CAM_W - 1)) * 0.5;
            t = Math.max(-1.0, Math.min(0.0, t));

            const voxel = getLeftStreamPoint(t, sTime);
            let r = 31, g = 119, b = 180, a = 0.2; 

            if (pixelData) {
                const idx = (v * CAM_W + u) * 4;
                r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
                r = Math.max(20, r); 
                a = (r + g + b) / 3 / 255; a = Math.max(0.15, a);
            }

            // Отрисовка исходящей Сфирали в нижнем Окне 2 (прореживаем для красоты линии)
            if (diagnosticCounter % 6 === 0 || pixelData) {
                const screenX = cxL + voxel.x * scaleL;
                const screenY = cyL + voxel.y * scaleL - (t * 20);
                glLocal.beginPath(); glLocal.arc(screenX, screenY, 2, 0, 2 * Math.PI);
                glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; glLocal.fill();
            }

            // Упаковываем пиксель. u и v жестко привязаны к цвету
            outgoingVoxelsPack.push({ x: voxel.x, y: voxel.y, z: t, u: u, v: v, r: r, g: g, b: b, a: a });
        }
    }

    // --- БЛОК Б: ДЕКОДИРОВАНИЕ И ПЛОТНАЯ СБОРКА СТРОК ПРЯМОУГОЛЬНОГО КАДРА (ОКНО 4) ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        const rW = reconImageCanvas.width;
        const rH = reconImageCanvas.height;
        const pScaleX = rW / CAM_W;
        const pScaleY = rH / CAM_H;

        lastReceivedData.forEach((voxel, index) => {
            // Отрисовка диагностических витков в нижнем Окне 3
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

            // ИСПРАВЛЕНО: Сборка плоского прямоугольного экрана кадра в Окне 4!
            // Браузер расставляет пиксели строго по их сохраненным индексам u и v
            if (voxel.u !== undefined && voxel.v !== undefined) {
                let rectX = voxel.u * pScaleX;
                let rectY = voxel.v * pScaleY;
                
                glRecon.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
                // Отрисовываем плотный сплошной квадратный пиксель
                glRecon.fillRect(rectX, rectY, Math.ceil(pScaleX) + 1, Math.ceil(pScaleY) + 1);
            }
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
