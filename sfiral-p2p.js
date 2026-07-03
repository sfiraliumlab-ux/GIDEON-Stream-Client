/**
 * GIDEON-Stream-Client // Математическое ядро P2P-кодека
 * РЕАЛИЗАЦИЯ КАНАЛА КОМПЛЕМЕНТАРНОЙ ЭКОНОМИИ 50% ТРАФИКА
 */

const SfiralP2P = {
    // Канонические параметры структуры автора
    R_coil: 1.8,       
    Height_Coil: 1.2,  
    Height_S: 0.4,     
    sArcRatio: 0.3,    // 30% диапазона отдано под S-образный мост инверсии

    /**
     * СИСТЕМА ПЕРЕДАЧИ (ТРАНСЛЯТОР)
     * Генерирует воксели СТРОГО для левой половины Сфирали (t от -1.0 до 0.0)
     * Правая половина отсекается для экономии 50% трафика в сети
     */
    getLeftStreamVoxel(t, phase) {
        // Жестко ограничиваем входящий параметр только левой стороной
        if (t > 0) t = -t; 
        
        const absT = Math.abs(t); 
        let x = 0; let y = 0; let z = 0;

        const R_arc = this.R_coil / 2.0;

        if (absT <= this.sArcRatio) {
            // S-дуга инверсии левой стороны
            const localT = absT / this.sArcRatio; 
            const phi = Math.PI * (1 - localT);
            x = R_arc + R_arc * Math.cos(phi);
            y = -R_arc * Math.sin(phi);
            z = (this.Height_S / 2) * localT;
        } else {
            // Основной виток V- левой стороны
            const localT = (absT - this.sArcRatio) / (1.0 - this.sArcRatio); 
            const theta = 2 * Math.PI * localT; 
            x = this.R_coil * Math.cos(theta);
            y = this.R_coil * Math.sin(theta);
            z = (this.Height_S / 2) + (this.Height_Coil * localT);
        }

        // Применяем антисимметрию для левой стороны (инверсия знаков)
        x = -x; y = -y; z = -z;

        // Вращение по текущей временной фазе
        const rotatedX = x * Math.cos(phase) - y * Math.sin(phase);
        const rotatedY = x * Math.sin(phase) + y * Math.cos(phase);

        return { x: rotatedX, y: rotatedY, zOffset: z };
    },

    /**
     * СИСТЕМА ПРИЕМА (РЕГЕНЕРАТОР)
     * Принимает координаты левой точки и зеркально достраивает правый виток V+
     * Реализует закон инверсии хиральности P_left = -P_right на стороне клиента
     */
    reconstructRightVoxel(leftVoxel) {
        return {
            x: -leftVoxel.x,       // Инверсия по оси X
            y: -leftVoxel.y,       // Инверсия по оси Y
            zOffset: -leftVoxel.zOffset // Инверсия по оси Z (свитие)
        };
    },

    /**
     * Канонический градиент кодека (Синий — исходящий поток, Красный — принятый/регенерированный)
     */
    getStreamColor(t, isRemote = false) {
        if (isRemote) {
            return { r: 214, g: 39, b: 40, a: 0.9 };  // Регенерированный виток V+ (Красный)
        } else {
            return { r: 31, g: 119, b: 180, a: 0.9 }; // Исходящий сжатый виток V- (Синий)
        }
    }
};
