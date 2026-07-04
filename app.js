/**
 * GIDEON-Stream-Client // Сетевой координатор через Четырехоконный Визуальный Мост
 */

const localCanvas = document.getElementById('localCanvas');
const glLocal = localCanvas.getContext('2d');
const remoteCanvas = document.getElementById('remoteCanvas');
const glRemote = remoteCanvas.getContext('2d');

// Новое Окно 4 для вывода плоского восстановленного кадра
const reconImageCanvas = document.getElementById('reconstructedImageCanvas');
const glRecon = reconImageCanvas.getContext('2d');

const hiddenCanvas = document.getElementById('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d');
const localVideo = document.getElementById('localVideo');

const toggleCamBtn = document.getElementById('toggleCamBtn');
const btnPack = document.getElementById('btnPack');
const fileImport = document.getElementById('fileImport');
const netStatus = document.getElementById('netStatus');

const DENSITY = 600; // Повышаем плотность точек для лучшей детализации картинки
let sTime = 0;
let isCamActive = false; 

let outgoingVoxelsPack = []; 
let lastReceivedData = null;  

function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth; localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth; remoteCanvas.height = remoteCanvas.clientHeight;
    reconImageCanvas.width = reconImageCanvas.clientWidth; reconImageCanvas.height = reconImageCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// Управление камерой
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
    a.download = `gideon_compressed_vminus_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    netStatus.innerText = "СТАТУС: ФАЙЛ СФИРАЛИ V- УСПЕШНО СОХРАНЕН"; netStatus.style.color = "#bd00ff";
});

// Операция объективного приема файла
fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            lastReceivedData = JSON.parse(event.target.result);
            netStatus.innerText = "СТАТУС: ВНЕШНИЙ СИГНАЛ ПРИНЯТ. РЕГЕНЕРАЦИЯ КАДРА ВЫПОЛНЕНА";
            netStatus.style.color = "#00ffcc";
        } catch(err) { alert("Ошибка файла Сфирали"); }
    };
    reader.readAsText(file);
});

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ И РЕКОНСТРУКЦИОННЫЙ КОНВЕЙЕР ---

function runStreamingPipeline() {
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
    glRecon.clearRect(0, 0, reconImageCanvas.width, reconImageCanvas.height);

    sTime += 0.004; // Замедляем авто-вращение для стабильности картинки

    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;
    
    // Масштабы под маленькие нижние окна сфирали
    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 3.5;
    const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 3.5;

    // Извлечение пикселей кадра в буфер
    if (isCamActive && localVideo.readyState >= 2 && localVideo.srcObject) {
        hCtx.clearRect(0, 0, 80, 60);
        hCtx.drawImage(localVideo, 0, 0, 80, 60);
        var pixelData = hCtx.getImageData(0, 0, 80, 60).data;
    }

    outgoingVoxelsPack = []; 
    const currentR = SfiralP2P.R_coil || 1.8;

    // --- БЛОК А: ГЕНЕРАЦИЯ СЖАТОГО ВИТКА V- ---
    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; 
        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);
        
        const screenX = cxL + leftVoxel.x * scaleL;
        const screenY = cyL + leftVoxel.y * scaleL - (t * 20);

        let r = 31, g = 119, b = 180, a = 0.85; 

        if (pixelData) {
            let u = Math.floor(((currentR - leftVoxel.x) / (currentR * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + currentR) / (currentR * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));
            const idx = (v * 80 + u) * 4; r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2]; a = (r + g + b) / 3 / 255;
        }

        if (a > 0.08) {
            glLocal.beginPath(); glLocal.arc(screenX, screenY, 2.5, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; glLocal.fill();

            // Записываем точки в исходящий буфер
            outgoingVoxelsPack.push({ x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b, a });
        }
    }

    // --- БЛОК Б: ПРИЕМ И ОДНОВРЕМЕННАЯ СБОРКА ПЛОСКОЙ КАРТИНКИ (ОКНО 4) ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        // Подготовка сетки Окна 4 для обратного рендеринга картинки
        const rW = reconImageCanvas.width;
        const rH = reconImageCanvas.height;
        const vScale = Math.min(rW, rH) / 1.3;

        lastReceivedData.forEach(voxel => {
            // 1. Отрисовка левого витка V- в Окне 3
            const scrLeftX = cxR + voxel.x * scaleR;
            const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 20);
            glRemote.beginPath(); glRemote.arc(scrLeftX, scrLeftY, 2.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`; glRemote.fill();

            // 2. Восстановление правого витка V+ в Окне 3 по закону антисимметрии
            const rightVoxel = SfiralP2P.reconstructRightVoxel({ x: voxel.x, y: voxel.y, zOffset: voxel.z });
            const scrRightX = cxR + rightVoxel.x * scaleR;
            const scrRightY = cyR + rightVoxel.y * scaleR - ((-voxel.z) * 20); 
            glRemote.beginPath(); glRemote.arc(scrRightX, scrRightY, 2.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(214, 39, 40, ${voxel.a})`; glRemote.fill();

            // 3. СБОРКА ОБЪЕКТИВНОГО КАДРА (ОКНО 4): Обратное развертывание 3D вокселей на 2D экран
            // Мы берем цвета из левого сохраненного витка, а координаты рассчитываем обратно на плоскость кадра
            let imgU = (rW / 2) + (voxel.x * vScale / (currentR * 2));
            let imgV = (rH / 2) + (voxel.y * vScale / (currentR * 2));

            glRecon.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
            glRecon.fillRect(imgU, imgV, 6, 6); // Рисуем плоские пиксели восстановленной картинки

            // Сборка второй половины кадра из регенерированного витка V+
            let imgU_right = (rW / 2) + (rightVoxel.x * vScale / (currentR * 2));
            let imgV_right = (rH / 2) + (rightVoxel.y * vScale / (currentR * 2));
            
            glRecon.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
            glRecon.fillRect(imgU_right, imgV_right, 6, 6);
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
