/**
 * GIDEON-Stream-Client // Сетевой координатор через Файловый Объективный Мост
 */

const localCanvas = document.getElementById('localCanvas');
const glLocal = localCanvas.getContext('2d');
const remoteCanvas = document.getElementById('remoteCanvas');
const glRemote = remoteCanvas.getContext('2d');

const hiddenCanvas = document.getElementById('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d');
const localVideo = document.getElementById('localVideo');

const toggleCamBtn = document.getElementById('toggleCamBtn');
const btnPack = document.getElementById('btnPack');
const fileImport = document.getElementById('fileImport');
const netStatus = document.getElementById('netStatus');

const DENSITY = 400; 
let sTime = 0;
let isCamActive = false; 

let outgoingVoxelsPack = []; // Буфер вашего исходящего сжатого витка
let lastReceivedData = null;  // Буфер ПРИНЯТОГО ИЗВНЕ витка

function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth; localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth; remoteCanvas.height = remoteCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// Управление камерой
toggleCamBtn.addEventListener('click', () => {
    isCamActive = !isCamActive;
    if (isCamActive) {
        toggleCamBtn.innerText = "Выключить камеру";
        toggleCamBtn.style.borderColor = "#bd00ff";
        navigator.mediaDevices.getUserMedia({ video: { width: 80, height: 60 } }).then(s => {
            localVideo.srcObject = s; localVideo.play();
        }).catch(e => { isCamActive = false; });
    } else {
        toggleCamBtn.innerText = "Включить камеру";
        toggleCamBtn.style.borderColor = "#00ffcc";
        if (localVideo.srcObject) { localVideo.srcObject.getTracks().forEach(t => t.stop()); localVideo.srcObject = null; }
        localVideo.pause();
    }
});

// КНОПКА ЗАПАКОВКИ 50% СФИРАЛИ В ФАЙЛ
btnPack.addEventListener('click', () => {
    if (outgoingVoxelsPack.length === 0) return alert("Конвейер пуст. Включите камеру для захвата.");
    
    // Создаем текстовый файл структуры
    const fileText = JSON.stringify(outgoingVoxelsPack);
    const blob = new Blob([fileText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `gideon_compressed_vminus_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    netStatus.innerText = "СТАТУС: ФАЙЛ СФИРАЛИ V- СОХРАНЕН. ОТПРАВЬТЕ ЕГО СОБЕСЕДНИКУ";
    netStatus.style.color = "#bd00ff";
});

// ОПЕРАЦИЯ ОБЪЕКТИВНОГО ПРИЕМА СИГНАЛА
fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0]; // Берем конкретный выбранный файл
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            // ИСПРАВЛЕНО: Читаем файл как чистый текст и переводим в массив объектов
            lastReceivedData = JSON.parse(event.target.result);
            netStatus.innerText = "СТАТУС: ВНЕШНИЙ СИГНАЛ ПРИНЯТ. ЗАПУЩЕНА 100% РЕГЕНЕРАЦИЯ";
            netStatus.style.color = "#00ffcc";
        } catch(err) { 
            alert("Ошибка чтения данных. Убедитесь, что загружаете правильный .json файл Сфирали."); 
        }
    };
    // ИСПРАВЛЕНО: Вместо readAsDataURL используем чтение текста readAsText
    reader.readAsText(file);
});

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ КОНВЕЙЕР ---

function runStreamingPipeline() {
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);

    sTime += 0.006; 

    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;
    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 4;
    const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 4;

    let pixelData = null;
    if (isCamActive && localVideo.readyState >= 2 && localVideo.srcObject) {
        hCtx.clearRect(0, 0, 80, 60); hCtx.drawImage(localVideo, 0, 0, 80, 60);
        pixelData = hCtx.getImageData(0, 0, 80, 60).data;
    }

    outgoingVoxelsPack = []; // Очищаем буфер кадра
    const currentR = SfiralP2P.R_coil || 1.8;

    // --- БЛОК А: ГЕНЕРАЦИЯ СЖАТОГО ВИТКА V- (ЛЕВАЯ СТОРОНА) ---
    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; 

        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);
        const screenX = cxL + leftVoxel.x * scaleL;
        const screenY = cyL + leftVoxel.y * scaleL - (t * 40);

        let r = 31, g = 119, b = 180, a = 0.85; 

        if (pixelData) {
            let u = Math.floor(((currentR - leftVoxel.x) / (currentR * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + currentR) / (currentR * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));
            const idx = (v * 80 + u) * 4; r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2]; a = (r + g + b) / 3 / 255;
        }

        if (a > 0.08) {
            glLocal.beginPath(); glLocal.arc(screenX, screenY, 3.5, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; glLocal.fill();

            // Сюда пишем только левую половину
            outgoingVoxelsPack.push({ x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b, a });
        }
    }

    // --- БЛОК Б: ПРИЕМ ВНЕШНЕГО СИГНАЛА И ЕГО 100% РЕГЕНЕРАЦИЯ ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        lastReceivedData.forEach(voxel => {
            // Отрисовываем то, что получили из файла (Левый синий виток V-)
            const scrLeftX = cxR + voxel.x * scaleR;
            const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 40);

            glRemote.beginPath(); glRemote.arc(scrLeftX, scrLeftY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`; glRemote.fill();

            // ПОДЛИННАЯ РЕГЕНЕРАЦИЯ: Достраиваем правое красное крыло V+ из пустоты
            const rightVoxel = SfiralP2P.reconstructRightVoxel({ x: voxel.x, y: voxel.y, zOffset: voxel.z });
            const scrRightX = cxR + rightVoxel.x * scaleR;
            const scrRightY = cyR + rightVoxel.y * scaleR - ((-voxel.z) * 40); 

            glRemote.beginPath(); glRemote.arc(scrRightX, scrRightY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(214, 39, 40, ${voxel.a})`; glRemote.fill();
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
