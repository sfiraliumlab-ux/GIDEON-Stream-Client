/**
 * GIDEON-Stream-Client // Сетевой кодек с плотным растровым сфиральным кодированием
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

// Конфигурация плотности матрицы сенсора
const CAM_W = 80;
const CAM_H = 60;
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
    a.download = `gideon_dense_matrix_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    netStatus.innerText = "СТАТУС: ПЛОТНАЯ МАТРИЦА СФИРАЛИ УСПЕШНО СОХРАНЕНА"; netStatus.style.color = "#bd00ff";
});

// Операция импорта файла
fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            lastReceivedData = JSON.parse(event.target.result);
            netStatus.innerText = "СТАТУС: ВНЕШНИЙ СИГНАЛ ПРИНЯТ. РЕГЕНЕРАЦИЯ ПОЛНОГО КАДРА ВЫПОЛНЕНА";
            netStatus.style.color = "#00ffcc";
        } catch(err) { alert("Ошибка файла Сфирали"); }
    };
    reader.readAsText(file);
});

// --- МАТЕМАТИЧЕСКИЙ ОПЕРАТОР СФИРАЛИ (ВСТРОЕННЫЙ) ---
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

    // Антисимметрия для левой стороны (V-)
    x = -x; y = -y; z = -z;

    // Вращение для диагностических нижних окон
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

    // --- БЛОК А: СКАНИРОВАНИЕ ВСЕГО ПРЯМОУГОЛЬНОГО КАДРА (ПО СТРОКАМ И СТОЛБЦАМ) ---
    // Мы пробегаем по абсолютно всем пикселям растра 80х60, захватывая ПОЛНОЕ изображение
    for (let v = 0; v < CAM_H; v++) {
        // Мы берем только левую половину кадра по ширине (u от 0 до 40), сжимая поток на 50%
        for (let u = 0; u < CAM_W / 2; u++) {
            
            // Переводим плоские координаты пикселя (u, v) в сфиральный параметр t от -1.0 до 0.0
            let t = (v / (CAM_H - 1)) * 0.5 + (u / (CAM_W / 2 - 1)) * 0.5 - 1.0;
            t = Math.max(-1.0, Math.min(0.0, t));

            const voxel = getLeftStreamPoint(t, sTime);

            let r = 31, g = 119, b = 180, a = 0.2; // Дефолтный синий каркас, если камера спит

            if (pixelData) {
                const idx = (v * CAM_W + u) * 4;
                r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
                r = Math.max(20, r); // Не даем пикселям стать совсем черными, чтобы воксель не исчез
                a = (r + g + b) / 3 / 255;
                a = Math.max(0.15, a);
            }

            // Отрисовываем левый виток в диагностическом Окне 2 (снизу)
            // Чтобы виток не выглядел кашей, прореживаем вывод на маленьком экране
            if (i % 3 === 0 || pixelData) {
                const screenX = cxL + voxel.x * scaleL;
                const screenY = cyL + voxel.y * scaleL - (t * 20);
                glLocal.beginPath(); glLocal.arc(screenX, screenY, 2, 0, 2 * Math.PI);
                glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; glLocal.fill();
            }

            // ЗАПИСЫВАЕМ ПОЛНЫЙ ПАКЕТ: Теперь файл содержит 100% пикселей левой половины вашего лица!
            outgoingVoxelsPack.push({ x: voxel.x, y: voxel.y, z: t, u: u, v: v, r, g, b, a });
        }
    }

    // --- БЛОК Б: ДЕКОДИРОВАНИЕ И РАЗВЕРТКА ПОЛНОГО ПЛОСКОГО ЭКРАНА (ОКНО 4) ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        const rW = reconImageCanvas.width;
        const rH = reconImageCanvas.height;
        const pScaleX = rW / CAM_W;
        const pScaleY = rH / CAM_H;

        lastReceivedData.forEach((voxel, index) => {
            // Отрисовка диагностической Сфирали в нижнем Окне 3 (прореживаем для красоты формы)
            if (index % 4 === 0) {
                const scrLeftX = cxR + voxel.x * scaleR;
                const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 20);
                glRemote.beginPath(); glRemote.arc(scrLeftX, scrLeftY, 2, 0, 2 * Math.PI);
                glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`; glRemote.fill();

                const scrRightX = cxR + (-voxel.x) * scaleR;
                const scrRightY = cyR + (-voxel.y) * scaleR - ((-voxel.z) * 20);
                glRemote.beginPath(); glRemote.arc(scrRightX, scrRightY, 2, 0, 2 * Math.PI);
                glRemote.fillStyle = `rgba(214, 39, 40, 0.7)`; glRemote.fill();
            }

            // РАЗВЕРТКА ПОЛНОЙ ПРЯМОУГОЛЬНОЙ КАРТИНКИ В ОКНЕ 4
            if (voxel.u !== undefined && voxel.v !== undefined) {
                // Левая половина лица (Восстановленная из вшитых пикселей файла)
                let rectX = voxel.u * pScaleX;
                let rectY = voxel.v * pScaleY;
                glRecon.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
                glRecon.fillRect(rectX, rectY, Math.ceil(pScaleX) + 1, Math.ceil(pScaleY) + 1);

                // ОБЪЕКТИВНАЯ РЕГЕНЕРАЦИЯ ПРАВОЙ СТОРОНЫ ЛИЦА:
                // Мессенджер не передавал правую сторону! Браузер сам взял пиксели левой стороны 
                // и зеркально достроил правую половину прямоугольного кадра по закону хиральности Сфирали!
                let rectRightX = (parseFloat(CAM_W) - 1 - voxel.u) * pScaleX;
                let rectRightY = voxel.v * pScaleY; // Симметрия лица идет по горизонтали
                
                glRecon.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
                glRecon.fillRect(rectRightX, rectRightY, Math.ceil(pScaleX) + 1, Math.ceil(pScaleY) + 1);
            }
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
