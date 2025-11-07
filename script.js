document.addEventListener('DOMContentLoaded', () => {
    // 取得 HTML 元素
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const score1El = document.getElementById('score1');
    const score2El = document.getElementById('score2');
    const player1ScoreBox = document.getElementById('player1-score');
    const player2ScoreBox = document.getElementById('player2-score');
    const gameOverMessage = document.getElementById('game-over-message'); 
    const winnerText = document.getElementById('winnerText');
    const confirmLineButton = document.getElementById('confirm-line-button');
    const cancelLineButton = document.getElementById('cancel-line-button');
    const actionBar = document.getElementById('action-bar');
    const resetButton = document.getElementById('reset-button');
    const modalOverlay = document.getElementById('modal-overlay');
    const resetButtonModal = document.getElementById('reset-button-modal');
    // AI 思考訊息
    const aiThinkingMessage = document.getElementById('ai-thinking-message'); 
    
    // **** 取得遊戲模式選單 (來自 Turn 5) ****
    const gameModeSelect = document.getElementById('game-mode-select');
    const boardSizeSelect = document.getElementById('board-size-select');
    // 連線格數按鈕
    const lineLengthSelect = document.getElementById('line-length-select');

    // **** AI 紀錄 DOM 元素 (來自 Turn 3) ****
    const aiLogContainer = document.getElementById('ai-log-container');
    const aiLogOutput = document.getElementById('ai-log-output');

    // 偵測是否為手機
    const isMobile = window.innerWidth < 768;
    
    // 遊戲設定 (根據是否為手機動態調整)
    let ROW_LENGTHS = []; 
    const DOT_SPACING_X = isMobile ? 60 : 100; 
    const DOT_SPACING_Y = DOT_SPACING_X * Math.sqrt(3) / 2;
    const PADDING = isMobile ? 30 : 50; 
    const DOT_RADIUS = isMobile ? 5 : 6; 
    const LINE_WIDTH = isMobile ? 5 : 6; 
    const CLICK_TOLERANCE_DOT = isMobile ? 20 : 15; 
    const ANGLE_TOLERANCE = 1.5; 

    // 依棋盤大小產生 ROW_LENGTHS
    function computeRowLengths(size) {
        switch (size) {
            case 'small':
                return [3, 4, 5, 4, 3];
            case 'large':
                return [5, 6, 7, 8, 9, 8, 7, 6, 5];
            case 'medium':
            default:
                return [4, 5, 6, 7, 6, 5, 4];
        }
    }

    // 玩家顏色
    const PLAYER_COLORS = {
        1: { line: '#3498db', fill: 'rgba(52, 152, 219, 0.3)' },
        2: { line: '#e74c3c', fill: 'rgba(231, 76, 60, 0.3)' },
        0: { line: '#95a5a6', fill: 'rgba(149, 165, 166, 0.2)' } 
    };
    const DEFAULT_LINE_COLOR = '#e0e0e0';

    // 遊戲狀態
    let currentPlayer = 1;
    let scores = { 1: 0, 2: 0 };
    let dots = []; 
    let lines = {}; 
    let triangles = [];
    let totalTriangles = 0;
    let selectedDot1 = null;
    let selectedDot2 = null;
    
    // **** 遊戲模式 (來自 Turn 5) ****
    // 0: 玩家 V.S. 玩家
    // 1: 玩家 V.S. 電腦
    // 2: 電腦 V.S. 電腦
    let gameMode = 0; 
    let REQUIRED_LINE_LENGTH = 3; 

    // 取得標準的線段 ID
    function getLineId(dot1, dot2) {
        if (!dot1 || !dot2) return null;
        let d1 = dot1, d2 = dot2;
        if (dot1.r > dot2.r || (dot1.r === dot2.r && dot1.c > dot2.c)) {
            d1 = dot2;
            d2 = dot1;
        }
        return `${d1.r},${d1.c}_${d2.r},${d2.c}`;
    }


    // 初始化遊戲
    function initGame() {
        // 讀取遊戲模式
        gameMode = parseInt(gameModeSelect.value, 10);
        
        const sizeValue = (boardSizeSelect && boardSizeSelect.value) ? boardSizeSelect.value : 'medium';
        ROW_LENGTHS = computeRowLengths(sizeValue);
        
        const lengthValue = (lineLengthSelect && lineLengthSelect.value) ? lineLengthSelect.value : '3';
        REQUIRED_LINE_LENGTH = parseInt(lengthValue, 10);

        const gridWidth = (Math.max(...ROW_LENGTHS) - 1) * DOT_SPACING_X;
        const gridHeight = (ROW_LENGTHS.length - 1) * DOT_SPACING_Y;
        canvas.width = gridWidth + PADDING * 2;
        canvas.height = gridHeight + PADDING * 2;

        currentPlayer = 1;
        scores = { 1: 0, 2: 0 };
        dots = [];
        lines = {};
        triangles = [];
        totalTriangles = 0;
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.remove('visible'); 
        modalOverlay.classList.add('hidden'); 
        
        if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');
        
        // **** 隱藏並清除 AI 紀錄 (來自 Turn 3) ****
        // 這是唯一清除日誌的地方
        if (aiLogContainer) aiLogContainer.classList.add('hidden');
        clearAILog();


        // 產生所有點的座標
        dots = [];
        ROW_LENGTHS.forEach((len, r) => {
            dots[r] = [];
            const rowWidth = (len - 1) * DOT_SPACING_X;
            const offsetX = (canvas.width - rowWidth) / 2;
            for (let c = 0; c < len; c++) {
                dots[r][c] = {
                    x: c * DOT_SPACING_X + offsetX,
                    y: r * DOT_SPACING_Y + PADDING,
                    r: r, c: c
                };
            }
        });

        // 產生所有 "相鄰" 線段
        lines = {};
        for (let r = 0; r < ROW_LENGTHS.length; r++) {
            for (let c = 0; c < ROW_LENGTHS[r]; c++) {
                const d1 = dots[r][c];
                // 橫向線
                if (c < ROW_LENGTHS[r] - 1) {
                    const d2 = dots[r][c + 1];
                    const id = getLineId(d1, d2);
                    lines[id] = { p1: d1, p2: d2, drawn: false, player: 0, sharedBy: 0, id: id };
                }
                // 斜向線
                if (r < ROW_LENGTHS.length - 1) {
                    const len1 = ROW_LENGTHS[r];
                    const len2 = ROW_LENGTHS[r+1];
                    if (len2 > len1) { // 菱形上半部
                        const d_dl = dots[r + 1][c];
                        const id_dl = getLineId(d1, d_dl);
                        lines[id_dl] = { p1: d1, p2: d_dl, drawn: false, player: 0, sharedBy: 0, id: id_dl };
                        const d_dr = dots[r + 1][c + 1];
                        const id_dr = getLineId(d1, d_dr);
                        lines[id_dr] = { p1: d1, p2: d_dr, drawn: false, player: 0, sharedBy: 0, id: id_dr };
                    } else { // 菱形下半部
                        if (c < len2) { 
                            const d_dl = dots[r + 1][c];
                            const id_dl = getLineId(d1, d_dl);
                            lines[id_dl] = { p1: d1, p2: d_dl, drawn: false, player: 0, sharedBy: 0, id: id_dl };
                        }
                        if (c > 0) { 
                            const d_dr = dots[r + 1][c - 1];
                            const id_dr = getLineId(d1, d_dr);
                            lines[id_dr] = { p1: d1, p2: d_dr, drawn: false, player: 0, sharedBy: 0, id: id_dr };
                        }
                    }
                }
            }
        }

        // 產生所有三角形
        triangles = [];
        totalTriangles = 0;
        for (let r = 0; r < ROW_LENGTHS.length - 1; r++) {
            const len1 = ROW_LENGTHS[r];
            const len2 = ROW_LENGTHS[r+1];
            if (len2 > len1) { // 菱形上半部
                for (let c = 0; c < len1; c++) {
                    const d1 = dots[r][c];
                    const d2 = dots[r+1][c];
                    const d3 = dots[r+1][c+1];
                    if (d1 && d2 && d3) {
                        triangles.push({
                            lineKeys: [getLineId(d1, d2), getLineId(d1, d3), getLineId(d2, d3)],
                            dots: [d1, d2, d3],
                            filled: false, player: 0
                        });
                        totalTriangles++;
                    }
                    if (c < len1 - 1) {
                        const d4 = dots[r][c+1];
                        if (d1 && d4 && d3) {
                            triangles.push({
                                lineKeys: [getLineId(d1, d4), getLineId(d1, d3), getLineId(d4, d3)],
                                dots: [d1, d4, d3],
                                filled: false, player: 0
                            });
                            totalTriangles++;
                        }
                    }
                }
            } else { // 菱形下半部
                for (let c = 0; c < len2; c++) {
                    const d1 = dots[r][c];
                    const d2 = dots[r][c+1];
                    const d3 = dots[r+1][c];
                    if (d1 && d2 && d3) {
                        triangles.push({
                            lineKeys: [getLineId(d1, d2), getLineId(d1, d3), getLineId(d2, d3)],
                            dots: [d1, d2, d3],
                            filled: false, player: 0
                        });
                        totalTriangles++;
                    }
                    if (c < len2 - 1) {
                        const d4 = dots[r+1][c+1];
                        if(d2 && d3 && d4) {
                            triangles.push({
                                lineKeys: [getLineId(d2, d3), getLineId(d2, d4), getLineId(d3, d4)],
                                dots: [d2, d3, d4],
                                filled: false, player: 0
                            });
                            totalTriangles++;
                        }
                    }
                }
            }
        }
        
        updateUI();
        drawCanvas();

        // CvC 模式下 AI 1 (P1) 自動開始
        if (gameMode === 2 && currentPlayer === 1) {
            if (aiThinkingMessage) aiThinkingMessage.classList.remove('hidden');
            if (aiLogContainer) aiLogContainer.classList.remove('hidden');
            setTimeout(makeAIMove, 50);
        }
    }

    // 繪製所有遊戲元素
    function drawCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 1. 繪製三角形
        triangles.forEach(tri => {
            if (tri.filled) {
                ctx.beginPath();
                ctx.moveTo(tri.dots[0].x, tri.dots[0].y);
                ctx.lineTo(tri.dots[1].x, tri.dots[1].y);
                ctx.lineTo(tri.dots[2].x, tri.dots[2].y);
                ctx.closePath();
                ctx.fillStyle = PLAYER_COLORS[tri.player].fill;
                ctx.fill();
            }
        });
        
        // 2. 繪製線條 (處理共享線)
        for (const id in lines) {
            const line = lines[id];
            
            if (line.drawn) {
                if (line.sharedBy !== 0 && line.sharedBy !== line.player) {
                    // --- 繪製共享線 (兩條並排) ---
                    const dx = line.p2.x - line.p1.x;
                    const dy = line.p2.y - line.p1.y;
                    const len = Math.sqrt(dx*dx + dy*dy);
                    const offsetX = -dy / len;
                    const offsetY = dx / len;
                    
                    const offset = LINE_WIDTH / 3; 
                    const halfWidth = LINE_WIDTH / 2; 
                    
                    // 原始玩家的線
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x + offsetX * offset, line.p1.y + offsetY * offset);
                    ctx.lineTo(line.p2.x + offsetX * offset, line.p2.y + offsetY * offset);
                    ctx.strokeStyle = PLAYER_COLORS[line.player].line;
                    ctx.lineWidth = halfWidth;
                    ctx.stroke();
                    
                    // 共享玩家的線
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x - offsetX * offset, line.p1.y - offsetY * offset);
                    ctx.lineTo(line.p2.x - offsetX * offset, line.p2.y - offsetY * offset);
                    ctx.strokeStyle = PLAYER_COLORS[line.sharedBy].line;
                    ctx.lineWidth = halfWidth;
                    ctx.stroke();

                } else {
                    // --- 繪製普通單人線 ---
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x, line.p1.y);
                    ctx.lineTo(line.p2.x, line.p2.y);
                    ctx.strokeStyle = PLAYER_COLORS[line.player].line;
                    ctx.lineWidth = LINE_WIDTH;
                    ctx.stroke();
                }
            } else {
                // --- 繪製預設的灰色虛線 ---
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = DEFAULT_LINE_COLOR;
                ctx.lineWidth = 2; 
                ctx.setLineDash([2, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // 3. 繪製點
        dots.forEach(row => {
            row.forEach(dot => {
                ctx.beginPath();
                ctx.arc(dot.x, dot.y, DOT_RADIUS, 0, 2 * Math.PI); 
                ctx.fillStyle = '#34495e';
                ctx.fill();
            });
        });

        // 4. 繪製選取的點 和 預覽虛線
        if (selectedDot1) {
            ctx.beginPath();
            ctx.arc(selectedDot1.x, selectedDot1.y, DOT_RADIUS + 3, 0, 2 * Math.PI);
            ctx.strokeStyle = PLAYER_COLORS[currentPlayer].line;
            ctx.lineWidth = 4; 
            ctx.stroke();
        }
        if (selectedDot2) {
            ctx.beginPath();
            ctx.arc(selectedDot2.x, selectedDot2.y, DOT_RADIUS + 3, 0, 2 * Math.PI);
            ctx.strokeStyle = PLAYER_COLORS[currentPlayer].line;
            ctx.lineWidth = 4; 
            ctx.stroke();
        }
        
        if (selectedDot1 && selectedDot2 && isValidPreviewLine(selectedDot1, selectedDot2, lines)) {
            ctx.beginPath();
            ctx.moveTo(selectedDot1.x, selectedDot1.y);
            ctx.lineTo(selectedDot2.x, selectedDot2.y);
            ctx.strokeStyle = PLAYER_COLORS[currentPlayer].line;
            ctx.lineWidth = 4; 
            ctx.setLineDash([8, 4]); 
            ctx.stroke();
            ctx.setLineDash([]); 
        }
    }

    // 點擊/觸控畫布
    function handleCanvasClick(e) {
        // 檢查是否輪到 AI
        const isP1AI = (gameMode === 2);
        const isP2AI = (gameMode === 1 || gameMode === 2);
        
        // 如果是 AI 的回合，禁止點擊
        if ((currentPlayer === 1 && isP1AI) || (currentPlayer === 2 && isP2AI)) {
            return;
        }

        if (actionBar.classList.contains('visible')) {
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        const mouseX = (clientX - rect.left) * scaleX;
        const mouseY = (clientY - rect.top) * scaleY;
        const clickedDot = findNearestDot(mouseX, mouseY);
        
        if (!clickedDot) {
            if (selectedDot1) cancelLine();
            return;
        }

        if (selectedDot1 === null) {
            selectedDot1 = clickedDot;
        } 
        else if (selectedDot2 === null) {
            if (clickedDot === selectedDot1) {
                selectedDot1 = null; 
            } else {
                if (isValidPreviewLine(selectedDot1, clickedDot, lines)) {
                    selectedDot2 = clickedDot;
                    actionBar.classList.add('visible');
                } else {
                    cancelLine();
                }
            }
        }
        drawCanvas();
    }

    // "確認連線" 按鈕
    function confirmLine() {
        if (!selectedDot1 || !selectedDot2) return;
        
        if (!isValidPreviewLine(selectedDot1, selectedDot2, lines)) {
            alert(`無效連線！(必須為 ${REQUIRED_LINE_LENGTH} 格且至少包含 1 格虛線)`);
            cancelLine();
            return;
        }

        const dotA = selectedDot1;
        const dotB = selectedDot2;

        const allDotsOnLine = findIntermediateDots(dotA, dotB);
        const segmentIds = [];
        for (let i = 0; i < allDotsOnLine.length - 1; i++) {
            segmentIds.push(getLineId(allDotsOnLine[i], allDotsOnLine[i+1]));
        }

        let newSegmentDrawn = false; 
        for (const id of segmentIds) {
            if (lines[id]) {
                if (!lines[id].drawn) { 
                    lines[id].drawn = true;
                    lines[id].player = currentPlayer; 
                    newSegmentDrawn = true; 
                } else if (lines[id].player !== 0 && lines[id].player !== currentPlayer) {
                    if (lines[id].sharedBy === 0) {
                        lines[id].sharedBy = currentPlayer;
                    }
                }
            }
        }

        if (!newSegmentDrawn) {
            alert(`無效連線！您必須至少連到一格虛線。`);
            cancelLine();
            return;
        }

        // 檢查得分
        let totalFilledThisGame = 0;
        triangles.forEach(tri => {
            if (!tri.filled) {
                const isComplete = tri.lineKeys.every(key => lines[key] && lines[key].drawn);
                if (isComplete) {
                    tri.filled = true;
                    tri.player = currentPlayer;
                    scores[currentPlayer]++;
                    
                    const scoreBox = (currentPlayer === 1) ? player1ScoreBox : player2ScoreBox;
                    scoreBox.classList.add('score-pulse');
                    setTimeout(() => {
                        scoreBox.classList.remove('score-pulse');
                    }, 400); 
                }
            }
            if (tri.filled) totalFilledThisGame++;
        });

        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.remove('visible'); 
        
        drawCanvas();
        updateUI(); 

        if (totalFilledThisGame === totalTriangles) {
            endGame();
            return;
        }

        switchPlayer();
    }

    // "取消選取" 按鈕
    function cancelLine() {
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.remove('visible');
        drawCanvas();
    }


    // ----- 輔助函式 -----

    function isClose(val, target) {
        return Math.abs(val - target) < ANGLE_TOLERANCE;
    }

    function findNearestDot(mouseX, mouseY) {
        let nearestDot = null;
        let minDisSq = CLICK_TOLERANCE_DOT ** 2; 
        dots.forEach(row => {
            row.forEach(dot => {
                const distSq = (mouseX - dot.x) ** 2 + (mouseY - dot.y) ** 2;
                if (distSq < minDisSq) {
                    minDisSq = distSq;
                    nearestDot = dot;
                }
            });
        });
        return nearestDot;
    }

    function findIntermediateDots(dotA, dotB) {
        const intermediateDots = [];
        const minX = Math.min(dotA.x, dotB.x) - 1;
        const maxX = Math.max(dotA.x, dotB.x) + 1;
        const minY = Math.min(dotA.y, dotB.y) - 1;
        const maxY = Math.max(dotA.y, dotB.y) + 1;
        const EPSILON = 1e-6; 

        dots.flat().forEach(dot => {
            if (dot.x >= minX && dot.x <= maxX && dot.y >= minY && dot.y <= maxY) {
                const crossProduct = (dotB.y - dotA.y) * (dot.x - dotB.x) - (dot.y - dotB.y) * (dotB.x - dotA.x);
                if (Math.abs(crossProduct) < EPSILON) {
                    intermediateDots.push(dot);
                }
            }
        });

        intermediateDots.sort((a, b) => {
            if (Math.abs(a.x - b.x) > EPSILON) return a.x - b.x;
            return a.y - b.y;
        });

        return intermediateDots;
    }
    
    // 檢查預覽連線是否有效
    function isValidPreviewLine(dotA, dotB, currentLines) {
        if (!dotA || !dotB) return false;

        // 1. 角度檢查
        const dy = dotB.y - dotA.y;
        const dx = dotB.x - dotA.x;
        if (dx !== 0 || dy !== 0) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const absAngle = Math.abs(angle);
            const isValidAngle = isClose(absAngle, 0) || 
                                 isClose(absAngle, 60) || 
                                 isClose(absAngle, 120) || 
                                 isClose(absAngle, 180);
            if (!isValidAngle) {
                return false; 
            }
        }

        // 2. 拆解長線為短線
        const allDotsOnLine = findIntermediateDots(dotA, dotB);
        const segmentIds = [];
        for (let i = 0; i < allDotsOnLine.length - 1; i++) {
            segmentIds.push(getLineId(allDotsOnLine[i], allDotsOnLine[i+1]));
        }
        if (segmentIds.length === 0) {
            return false; 
        }

        // 2.5. 長度檢查
        const requiredLineLength = REQUIRED_LINE_LENGTH; 
        if (segmentIds.length !== requiredLineLength) {
            return false; 
        }

        // 3. 檢查線段是否存在
        let allSegmentsExist = true;
        let hasUndrawnSegment = false; 
        
        for (const id of segmentIds) {
            if (!id || !currentLines[id]) { 
                allSegmentsExist = false;
                break;
            }
            if (!currentLines[id].drawn) {
                hasUndrawnSegment = true;
            }
        }
        if (!allSegmentsExist) {
            return false; 
        }

        // 5. 必須至少包含一格虛線
        if (!hasUndrawnSegment) {
            return false; 
        }

        return true;
    }


    // 切換玩家
    function switchPlayer() {
        // 檢查 AI 狀態 (來自 Turn 5)
        const isP1AI = (gameMode === 2);
        const isP2AI = (gameMode === 1 || gameMode === 2);
        
        // 如果目前玩家是 P1(AI) 或 P2(AI)，則不要隱藏日誌
        if (aiLogContainer) {
            if ((currentPlayer === 1 && isP1AI) || (currentPlayer === 2 && isP2AI)) {
                 // 保持顯示
            } else {
                // 下一輪是人類，隱藏
                 aiLogContainer.classList.add('hidden');
            }
        }

        currentPlayer = (currentPlayer === 1) ? 2 : 1;
        updateUI();

        // 檢查新玩家是否為 AI
        if ((currentPlayer === 1 && isP1AI) || (currentPlayer === 2 && isP2AI)) {
            if (aiThinkingMessage) aiThinkingMessage.classList.remove('hidden');
            // 確保日誌是可見的
            if (aiLogContainer) aiLogContainer.classList.remove('hidden');
            
            const delay = (gameMode === 2) ? 100 : 50;
            setTimeout(makeAIMove, delay); 
        } else {
             if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');
        }
    }

    // 更新 UI
    function updateUI() {
        score1El.textContent = scores[1];
        score2El.textContent = scores[2];
        
        // 根據 gameMode 更新玩家名稱
        let player1Name = (gameMode === 2) ? "電腦 1" : "玩家 1";
        let player2Name = (gameMode === 0) ? "玩家 2" : (gameMode === 1 ? "電腦" : "電腦 2");
        
        player1ScoreBox.childNodes[0].nodeValue = `${player1Name}: `;
        player2ScoreBox.childNodes[0].nodeValue = `${player2Name}: `;


        if (currentPlayer === 1) {
            player1ScoreBox.classList.add('active');
            player2ScoreBox.classList.remove('active', 'player2');
        } else {
            player1ScoreBox.classList.remove('active');
            player2ScoreBox.classList.add('active', 'player2');
        }
    }

    // 遊戲結束
    function endGame() {
        // 根據 gameMode 更新勝利訊息
        let player1Name = (gameMode === 2) ? "電腦 1" : "玩家 1";
        let player2Name = (gameMode === 0) ? "玩家 2" : (gameMode === 1 ? "電腦" : "電腦 2");
        
        let winnerMessage = "";

        if (scores[1] > scores[2]) {
            winnerMessage = `${player1Name} 獲勝！`;
        } else if (scores[2] > scores[1]) {
            winnerMessage = `${player2Name} 獲勝！`;
        } else {
            winnerMessage = "平手！";
        }
        winnerText.textContent = winnerMessage;
        
        modalOverlay.classList.remove('hidden'); 
        actionBar.classList.remove('visible'); 

        if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');
        // 遊戲結束時隱藏日誌
        if (aiLogContainer) aiLogContainer.classList.add('hidden');
    }


    // ----- AI 相關功能 (Minimax) -----

    // AI 搜尋深度 (來自 Turn 4)
    const AI_SEARCH_DEPTH = 7; 

    // AI 紀錄輔助函式 (來自 Turn 3)
    function logAI(message) {
        if (aiLogOutput) {
            aiLogOutput.textContent += message + '\n';
            aiLogOutput.scrollTop = aiLogOutput.scrollHeight;
        }
    }
    function clearAILog() {
        if (aiLogOutput) {
            aiLogOutput.textContent = '';
        }
    }


    // 輔助函式：深拷貝
    function deepCopy(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // 輔助函式：模擬一個移動
    function simulateMove(move, currentLines, currentTriangles, player) {
        const newLines = deepCopy(currentLines);
        const newTriangles = deepCopy(currentTriangles);
        let scoreGained = 0;

        let newSegmentDrawn = false;
        for (const id of move.segmentIds) {
            if (newLines[id]) { 
                if (!newLines[id].drawn) { 
                    newLines[id].drawn = true;
                    newLines[id].player = player;
                    newSegmentDrawn = true;
                } else if (newLines[id].player !== 0 && newLines[id].player !== player) {
                    if (newLines[id].sharedBy === 0) {
                        newLines[id].sharedBy = player;
                    }
                }
            }
        }

        if (!newSegmentDrawn) {
            return null; 
        }

        newTriangles.forEach(tri => {
            if (!tri.filled) {
                const isComplete = tri.lineKeys.every(key => newLines[key] && newLines[key].drawn);
                if (isComplete) {
                    tri.filled = true;
                    tri.player = player;
                    scoreGained++;
                }
            }
        });

        return { newLines, newTriangles, scoreGained };
    }

    // 輔助函式：評估當前棋盤 (Heuristic) (來自 Turn 4)
    // (P2 是 Maximizer, P1 是 Minimizer)
    function evaluateBoard(currentLines, currentTriangles) {
        let aiScore = 0; // P2 分數
        let humanScore = 0; // P1 分數
        let aiSetups = 0; 
        let humanSetups = 0; 

        currentTriangles.forEach(tri => {
            if (tri.filled) {
                if (tri.player === 2) aiScore++;
                else humanScore++;
            } else {
                // 檢查"聽牌" (差一條線)
                let drawnCount = 0;
                tri.lineKeys.forEach(key => {
                    if (currentLines[key] && currentLines[key].drawn) {
                        drawnCount++;
                    }
                });

                if (drawnCount === 2) {
                    let p1Lines = 0;
                    let p2Lines = 0;
                    tri.lineKeys.forEach(key => {
                        if (currentLines[key] && currentLines[key].drawn) {
                            if (currentLines[key].player === 1) p1Lines++;
                            if (currentLines[key].player === 2) p2Lines++;
                        }
                    });

                    if (p1Lines > p2Lines) humanSetups++;
                    else if (p2Lines > p1Lines) aiSetups++;
                }
            }
        });

        // 檢查遊戲是否結束
        let totalFilled = aiScore + humanScore;
        if (totalFilled === totalTriangles) {
            if (aiScore > humanScore) return 1000000; // P2 獲勝 (極高分)
            if (humanScore > aiScore) return -1000000; // P1 獲勝 (極低分)
            return 0; // 平手
        }

        // 總評分：(P2 分數 - P1 分數)
        return (aiScore * 100 - humanScore * 100) + (aiSetups * 10 - humanSetups * 10);
    }

    // 找出所有可能的走法
    function findAllValidMoves(currentLines) {
        const moves = [];
        const allDots = dots.flat();
        
        for (let i = 0; i < allDots.length; i++) {
            for (let j = i + 1; j < allDots.length; j++) {
                const dotA = allDots[i];
                const dotB = allDots[j];
                
                if (isValidPreviewLine(dotA, dotB, currentLines)) {
                    
                    const segmentIds = [];
                    const dotsOnLine = findIntermediateDots(dotA, dotB); 
                    
                    for (let k = 0; k < dotsOnLine.length - 1; k++) {
                        segmentIds.push(getLineId(dotsOnLine[k], dotsOnLine[k+1]));
                    }
                    moves.push({ dot1: dotA, dot2: dotB, segmentIds: segmentIds });
                }
            }
        }
        
        return moves;
    }

    // Minimax 演算法核心 (來自 Turn 4)
    function minimax(currentLines, currentTriangles, depth, isMaximizingPlayer, alpha, beta) {
        
        // 1. 檢查目前是否為終局
        const currentEval = evaluateBoard(currentLines, currentTriangles);
        if (Math.abs(currentEval) >= 1000000) { // 遊戲結束
            if (currentEval > 0) return currentEval + depth;
            return currentEval - depth;
        }
        
        // 2. 找到所有可能的下一步
        const allMoves = findAllValidMoves(currentLines);

        // 3. 終止條件 (達到最大深度 或 無棋可走)
        if (depth === 0 || allMoves.length === 0) {
            return currentEval;
        }

        if (isMaximizingPlayer) { // P2 (AI) 的回合 (Maximizer)
            let bestValue = -Infinity; 
            allMoves.sort(() => Math.random() - 0.5); 
            
            for (const move of allMoves) {
                const sim = simulateMove(move, currentLines, currentTriangles, 2); // 2 = P2
                if (!sim) continue;
                
                const immediateScore = sim.scoreGained * 1000;
                const futureValue = minimax(sim.newLines, sim.newTriangles, depth - 1, false, alpha, beta); // 換 P1
                const totalValue = immediateScore + futureValue; 

                bestValue = Math.max(bestValue, totalValue);
                alpha = Math.max(alpha, bestValue); 
                
                if (beta <= alpha) {
                    break; // Beta 剪枝
                }
            }
            return bestValue;

        } else { // P1 (玩家或 AI) 的回合 (Minimizer)
            let bestValue = +Infinity; 
            allMoves.sort(() => Math.random() - 0.5);

            for (const move of allMoves) {
                const sim = simulateMove(move, currentLines, currentTriangles, 1); // 1 = P1
                if (!sim) continue;
                
                const immediateScore = sim.scoreGained * 1000; 
                const futureValue = minimax(sim.newLines, sim.newTriangles, depth - 1, true, alpha, beta); // 換 P2
                
                const totalValue = -immediateScore + futureValue; 

                bestValue = Math.min(bestValue, totalValue);
                beta = Math.min(beta, bestValue); 
                
                if (beta <= alpha) {
                    break; // Alpha 剪枝
                }
            }
            return bestValue;
        }
    }

    // AI "大腦" (可處理 P1 或 P2) (來自 Turn 5)
    function findBestAIMove(player) {
        const isMaximizingPlayer = (player === 2);
        // (P2 是 Maximizer, P1 是 Minimizer)
        const playerName = isMaximizingPlayer ? "AI 2 (Max)" : "AI 1 (Min)";
        
        logAI(`--- ${playerName} 開始思考 (深度: ${AI_SEARCH_DEPTH}) ---`);
        
        const allMoves = findAllValidMoves(lines); 
        if (allMoves.length === 0) {
            logAI(`--- ${playerName} 找不到可走的步 ---`);
            return null; 
        }

        let bestMove = null;
        let bestValue = isMaximizingPlayer ? -Infinity : +Infinity;
        let alpha = -Infinity;
        let beta = +Infinity;

        allMoves.sort(() => Math.random() - 0.5);

        for (const move of allMoves) {
            // 1. 模擬走一步
            const sim = simulateMove(move, lines, triangles, player);
            if (!sim) continue; 

            // 2. 取得這一步的立即得分
            const immediateScore = sim.scoreGained * 1000;
            
            const moveId = `(${move.dot1.r},${move.dot1.c})-(${move.dot2.r},${move.dot2.c})`;
            logAI(`[${playerName}] 評估主要走法: ${moveId}`);

            // 3. 呼叫 minimax 估算 "對手 (Min/Max) 的最佳回應"
            const futureValue = minimax(sim.newLines, sim.newTriangles, AI_SEARCH_DEPTH - 1, !isMaximizingPlayer, alpha, beta);
            
            let totalMoveValue;
            if (isMaximizingPlayer) {
                totalMoveValue = immediateScore + futureValue; // P2 得分是正分
            } else {
                totalMoveValue = -immediateScore + futureValue; // P1 得分對 P2 是負分
            }

            logAI(`[${playerName}] 走法 ${moveId} 最終評分: ${totalMoveValue.toFixed(0)}`);

            if (isMaximizingPlayer) {
                if (totalMoveValue > bestValue) {
                    bestValue = totalMoveValue;
                    bestMove = move;
                }
                alpha = Math.max(alpha, bestValue);
            } else { // isMinimizingPlayer
                if (totalMoveValue < bestValue) {
                    bestValue = totalMoveValue;
                    bestMove = move;
                }
                beta = Math.min(beta, bestValue);
            }
        }
        
        if (bestMove) {
            logAI(`--- ${playerName} 決定走法: (${bestMove.dot1.r},${bestMove.dot1.c})-(${bestMove.dot2.r},${bestMove.dot2.c}) | 評分: ${bestValue.toFixed(0)} ---`);
        } else {
             logAI(`--- ${playerName} 最終沒有選擇任何走法 ---`);
        }
        
        return bestMove;
    }

    
    // AI 執行移動
    function makeAIMove() {
        try {
            // 檢查是否輪到 AI
            const isP1AI = (gameMode === 2);
            const isP2AI = (gameMode === 1 || gameMode === 2);
            if (!((currentPlayer === 1 && isP1AI) || (currentPlayer === 2 && isP2AI))) {
                return;
            }
            
            // **** (Turn 6) 修改：移除 clearAILog() ****
            // clearAILog(); 
            
            // 確保 AI 紀錄框是可見的
            if (aiLogContainer) aiLogContainer.classList.remove('hidden');


            // 呼叫 AI 大腦 (傳入當前玩家 1 或 2)
            const bestMove = findBestAIMove(currentPlayer);

            if (bestMove && bestMove.dot1 && bestMove.dot2) {
                const dotA = bestMove.dot1;
                const dotB = bestMove.dot2;
                
                const allDotsOnLine = findIntermediateDots(dotA, dotB);
                const segmentIds = [];
                for (let i = 0; i < allDotsOnLine.length - 1; i++) {
                    segmentIds.push(getLineId(allDotsOnLine[i], allDotsOnLine[i+1]));
                }
                
                let newSegmentDrawn = false; 

                // 畫新線或標記共享線
                for (const id of segmentIds) {
                    if (lines[id]) { 
                        if (!lines[id].drawn) { 
                            lines[id].drawn = true;
                            lines[id].player = currentPlayer; // 使用 currentPlayer
                            newSegmentDrawn = true;
                        } else if (lines[id].player !== 0 && lines[id].player !== currentPlayer) {
                            if (lines[id].sharedBy === 0) {
                                lines[id].sharedBy = currentPlayer; // 使用 currentPlayer
                            }
                        }
                    }
                }

                if (!newSegmentDrawn) {
                    switchPlayer();
                    return;
                }

                // 檢查得分
                let totalFilledThisGame = 0;
                triangles.forEach(tri => {
                    if (!tri.filled) {
                        const isComplete = tri.lineKeys.every(key => lines[key] && lines[key].drawn);
                        if (isComplete) {
                            tri.filled = true;
                            tri.player = currentPlayer;
                            scores[currentPlayer]++;
                            
                            const scoreBox = (currentPlayer === 1) ? player1ScoreBox : player2ScoreBox;
                            scoreBox.classList.add('score-pulse');
                            setTimeout(() => {
                                scoreBox.classList.remove('score-pulse');
                            }, 400); 
                        }
                    }
                    if (tri.filled) totalFilledThisGame++;
                });
                
                drawCanvas();
                updateUI(); 

                if (totalFilledThisGame === totalTriangles) {
                    endGame();
                    return;
                }

                switchPlayer();

            } else {
                // 沒找到任何可走的線
                switchPlayer();
            }
        } catch (error) {
            console.error("AI 執行時發生錯誤:", error);
            logAI(`AI 執行時發生錯誤: ${error.message}`);
            switchPlayer();
        }
    }
    
    // ----------------------------
    
    // 綁定所有事件
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        handleCanvasClick(e);
    });

    resetButton.addEventListener('click', initGame);
    resetButtonModal.addEventListener('click', initGame);
    confirmLineButton.addEventListener('click', confirmLine);
    cancelLineButton.addEventListener('click', cancelLine);
    
    // 綁定模式和棋盤事件 (來自 Turn 5)
    if (gameModeSelect) {
        gameModeSelect.addEventListener('change', initGame);
    }
    if (boardSizeSelect) {
        boardSizeSelect.addEventListener('change', initGame);
    }
    if (lineLengthSelect) {
        lineLengthSelect.addEventListener('change', initGame);
    }

    // 啟動遊戲
    initGame();
});