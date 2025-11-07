document.addEventListener('DOMContentLoaded', () => {
    // 取得 HTML 元素
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const score1El = document.getElementById('score1');
    const score2El = document.getElementById('score2');
    const player1ScoreBox = document.getElementById('player1-score');
    const player2ScoreBox = document.getElementById('player2-score');
    const gameOverMessage = document.getElementById('game-over-message'); 
    
    // **** (BugFix) 修正 ID 大小寫 ****
    // (原：'winnerText')
    const winnerText = document.getElementById('winner-text'); 
    // **** (BugFix) 結束 ****
    
    const confirmLineButton = document.getElementById('confirm-line-button');
    const cancelLineButton = document.getElementById('cancel-line-button');
    const actionBar = document.getElementById('action-bar');
    const resetButton = document.getElementById('reset-button');
    const modalOverlay = document.getElementById('modal-overlay');
    const resetButtonModal = document.getElementById('reset-button-modal');
    const aiThinkingMessage = document.getElementById('ai-thinking-message'); 
    const gameModeSelect = document.getElementById('game-mode-select');
    const boardSizeSelect = document.getElementById('board-size-select');
    const lineLengthSelect = document.getElementById('line-length-select');
    const aiLogContainer = document.getElementById('ai-log-container');
    const aiLogOutput = document.getElementById('ai-log-output');
    
    // (新功能) 取得匯出按鈕
    const exportLogButton = document.getElementById('export-log-button');

    // 偵測是否為手機
    const isMobile = window.innerWidth < 768;
    
    // 遊戲設定
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
    let gameMode = 0; 
    let REQUIRED_LINE_LENGTH = 1; 

    // 遊戲紀錄 (使用上一版的物件結構)
    let gameHistoryLog = {};
    let turnCounter = 1;
    // ===================================
    // Web Worker 相關
    // ===================================
    let aiWorker = null;
    let isAIThinking = false; 
    
    function initializeAIWorker() {
        if (aiWorker) {
            aiWorker.terminate();
        }
        aiWorker = new Worker('ai-worker.js');
        aiWorker.onmessage = (e) => {
            const data = e.data;
            if (data.type === 'log') {
                logAI(data.message);
            } else if (data.type === 'progress') {
                logAI(data.message);
            } else if (data.type === 'result') {
                isAIThinking = false; 
                const endTime = performance.now();
                const duration = (endTime - aiStartTime) / 1000;
                logAI(`--- (主線程) 總耗時: ${duration.toFixed(2)} 秒 ---`);
                handleAIMoveResult(data.bestMove);
            }
        };
        aiWorker.onerror = (e) => {
            logAI(`--- [Worker 錯誤] ${e.message} ---`);
            console.error("AI Worker Error:", e);
            isAIThinking = false;
            if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');
        };
    }
    
    // AI 紀錄輔助函式
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
    // ===================================

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
        try {
            initializeAIWorker();
        } catch (e) {
            console.error("無法初始化 AI Worker:", e);
            alert("錯誤：無法載入 AI Worker。請確保您是透過 http:// (本地伺服器) 執行，而不是 file:/// (直接開啟檔案)。");
            return;
        }
        isAIThinking = false;
        
        // 重設遊戲紀錄 (物件)
        turnCounter = 1;
        gameHistoryLog = {
            settings: {
                boardSize: boardSizeSelect.value,
                lineLength: lineLengthSelect.value,
                gameMode: gameModeSelect.options[gameModeSelect.selectedIndex].text,
                dateTime: new Date().toISOString()
            },
            turns: [],
            summary: {}
        };

        // 讀取遊戲模式
        gameMode = parseInt(gameModeSelect.value, 10);
        
        const sizeValue = (boardSizeSelect && boardSizeSelect.value) ? boardSizeSelect.value : 'medium';
        ROW_LENGTHS = computeRowLengths(sizeValue);
        
        const lengthValue = (lineLengthSelect && lineLengthSelect.value) ? lineLengthSelect.value : '1';
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
                if (c < ROW_LENGTHS[r] - 1) {
                    const d2 = dots[r][c + 1];
                    const id = getLineId(d1, d2);
                    lines[id] = { p1: d1, p2: d2, drawn: false, player: 0, sharedBy: 0, id: id };
                }
                if (r < ROW_LENGTHS.length - 1) {
                    const len1 = ROW_LENGTHS[r];
                    const len2 = ROW_LENGTHS[r+1];
                    if (len2 > len1) { 
                        const d_dl = dots[r + 1][c];
                        const id_dl = getLineId(d1, d_dl);
                        lines[id_dl] = { p1: d1, p2: d_dl, drawn: false, player: 0, sharedBy: 0, id: id_dl };
                        const d_dr = dots[r + 1][c + 1];
                        const id_dr = getLineId(d1, d_dr);
                        lines[id_dr] = { p1: d1, p2: d_dr, drawn: false, player: 0, sharedBy: 0, id: id_dr };
                    } else { 
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
            if (len2 > len1) { 
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
            } else { 
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
        
        const isP1AI = (gameMode === 2);
        
        if (isP1AI) {
            triggerAIMove();
        } else {
            const allMoves = findAllValidMoves(lines);
            if (allMoves.length === 0) {
                logAI("--- 遊戲開始，但玩家 1 已無棋可走 ---");
                if (aiLogContainer) aiLogContainer.classList.remove('hidden');
                endGame();
                return;
            }
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
        
        // 2. 繪製線條
        for (const id in lines) {
            const line = lines[id];
            
            if (line.drawn) {
                if (line.sharedBy !== 0 && line.sharedBy !== line.player) {
                    // 共享線
                    const dx = line.p2.x - line.p1.x;
                    const dy = line.p2.y - line.p1.y;
                    const len = Math.sqrt(dx*dx + dy*dy);
                    const offsetX = -dy / len;
                    const offsetY = dx / len;
                    const offset = LINE_WIDTH / 3; 
                    const halfWidth = LINE_WIDTH / 2; 
                    
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x + offsetX * offset, line.p1.y + offsetY * offset);
                    ctx.lineTo(line.p2.x + offsetX * offset, line.p2.y + offsetY * offset);
                    ctx.strokeStyle = PLAYER_COLORS[line.player].line;
                    ctx.lineWidth = halfWidth;
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x - offsetX * offset, line.p1.y - offsetY * offset);
                    ctx.lineTo(line.p2.x - offsetX * offset, line.p2.y - offsetY * offset);
                    ctx.strokeStyle = PLAYER_COLORS[line.sharedBy].line;
                    ctx.lineWidth = halfWidth;
                    ctx.stroke();
                } else {
                    // 普通線
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x, line.p1.y);
                    ctx.lineTo(line.p2.x, line.p2.y);
                    ctx.strokeStyle = PLAYER_COLORS[line.player].line;
                    ctx.lineWidth = LINE_WIDTH;
                    ctx.stroke();
                }
            } else {
                // 虛線
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
        if (isAIThinking) {
            return;
        }
        const isP1AI = (gameMode === 2);
        const isP2AI = (gameMode === 1 || gameMode === 2);
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
        
        const moveResult = applyMoveToBoard(selectedDot1, selectedDot2, currentPlayer);

        if (!moveResult.newSegmentDrawn) {
            alert(`無效連線！您必須至少連到一格虛線。`);
            cancelLine();
            return;
        }

        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.remove('visible'); 
        
        drawCanvas();
        updateUI(); 

        if (moveResult.gameEnded) {
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


    // ----- 輔助函式 (UI 相關) -----

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
    
    function isValidPreviewLine(dotA, dotB, currentLines) {
        if (!dotA || !dotB) return false;
        const dy = dotB.y - dotA.y;
        const dx = dotB.x - dotA.x;
        if (dx !== 0 || dy !== 0) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const absAngle = Math.abs(angle);
            const isValidAngle = isClose(absAngle, 0) || isClose(absAngle, 60) || isClose(absAngle, 120) || isClose(absAngle, 180);
            if (!isValidAngle) return false; 
        }
        const allDotsOnLine = findIntermediateDots(dotA, dotB);
        const segmentIds = [];
        for (let i = 0; i < allDotsOnLine.length - 1; i++) {
            segmentIds.push(getLineId(allDotsOnLine[i], allDotsOnLine[i+1]));
        }
        if (segmentIds.length === 0 && dotA !== dotB) return false;
        if (segmentIds.length !== REQUIRED_LINE_LENGTH) return false; 
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
        if (!allSegmentsExist) return false; 
        if (!hasUndrawnSegment) return false; 
        return true;
    }
    
    function findAllValidMoves(currentLines) {
        const moves = [];
        const allDots = dots.flat();
        for (let i = 0; i < allDots.length; i++) {
            for (let j = i + 1; j < allDots.length; j++) {
                const dotA = allDots[i];
                const dotB = allDots[j];
                if (isValidPreviewLine(dotA, dotB, currentLines)) {
                    moves.push(true);
                }
            }
        }
        return moves;
    }


    // 切換玩家
    function switchPlayer() {
        const isP1AI_current = (gameMode === 2);
        const isP2AI_current = (gameMode === 1 || gameMode === 2);
        if (aiLogContainer) {
            if ((currentPlayer === 1 && isP1AI_current) || (currentPlayer === 2 && isP2AI_current)) {
            } else {
                 aiLogContainer.classList.add('hidden');
            }
        }

        currentPlayer = (currentPlayer === 1) ? 2 : 1;
        updateUI();

        const isP1AI_new = (gameMode === 2);
        const isP2AI_new = (gameMode === 1 || gameMode === 2);
        const isNewPlayerAI = (currentPlayer === 1 && isP1AI_new) || (currentPlayer === 2 && isP2AI_new);

        if (isNewPlayerAI) {
            triggerAIMove();
        } else {
            if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');
            
            const allMoves = findAllValidMoves(lines);
            if (allMoves.length === 0) {
                const playerName = (currentPlayer === 1) ? "玩家 1" : "玩家 2";
                logAI(`--- 輪到 ${playerName}，但已無棋可走 ---`);
                if (aiLogContainer) aiLogContainer.classList.remove('hidden'); 
                endGame();
                return;
            }
        }
    }

    // 更新 UI
    function updateUI() {
        score1El.textContent = scores[1];
        score2El.textContent = scores[2];
        
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
        if (isAIThinking) {
            if (aiWorker) aiWorker.terminate();
            isAIThinking = false;
        }
        
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
        
        // **** (BugFix) 確保 winnerText 物件存在才設定 ****
        if (winnerText) {
            winnerText.textContent = winnerMessage;
        } else {
            console.error("找不到 'winner-text' 元素！");
        }
        
        // 紀錄遊戲總結
        gameHistoryLog.summary = {
            finalScoreP1: scores[1],
            finalScoreP2: scores[2],
            winnerMessage: winnerMessage
        };
        
        modalOverlay.classList.remove('hidden'); 
        actionBar.classList.remove('visible'); 

        if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');
        if (aiLogContainer) aiLogContainer.classList.add('hidden');
    }


    // ----- AI 相關功能 (主線程) -----
    
    let aiStartTime = 0; 
    
    function triggerAIMove() {
        if (isAIThinking) return; 
        
        const allMoves = findAllValidMoves(lines);
        if (allMoves.length === 0) {
            const playerName = (currentPlayer === 2) ? "AI 2 (Max)" : "AI 1 (Min)";
            logAI(`--- ${playerName} 已無棋可走，遊戲結束 ---`);
            if (aiLogContainer) aiLogContainer.classList.remove('hidden');
            endGame(); // (*** 這裡會呼叫 endGame，並正確顯示勝利者 ***)
            return;
        }

        isAIThinking = true;
        if (aiThinkingMessage) aiThinkingMessage.classList.remove('hidden');
        if (aiLogContainer) aiLogContainer.classList.remove('hidden');
        
        logAI(`--- [主線程] 傳送遊戲狀態到 Worker ---`);
        aiStartTime = performance.now();
        
        aiWorker.postMessage({
            command: 'start',
            gameState: {
                dots: dots,
                lines: lines,
                triangles: triangles,
                player: currentPlayer,
                totalTriangles: totalTriangles,
                requiredLineLength: REQUIRED_LINE_LENGTH
            }
        });
    }

    function handleAIMoveResult(bestMove) {
        if (aiThinkingMessage) aiThinkingMessage.classList.add('hidden');

        if (bestMove && bestMove.dot1 && bestMove.dot2) {
            const dotA = dots[bestMove.dot1.r][bestMove.dot1.c];
            const dotB = dots[bestMove.dot2.r][bestMove.dot2.c];

            const moveResult = applyMoveToBoard(dotA, dotB, currentPlayer);

            if (!moveResult.newSegmentDrawn) {
                logAI(`--- [錯誤] AI 傳回無效移動 ---`);
                switchPlayer();
                return;
            }
            
            drawCanvas();
            updateUI(); 

            if (moveResult.gameEnded) {
                endGame();
                return;
            }

            switchPlayer();

        } else {
            logAI(`--- [主線程] AI 未傳回走法，遊戲結束 ---`);
            endGame(); // (*** 這裡也會呼叫 endGame ***)
        }
    }
    
    /**
     * 將移動應用於棋盤 (人類和 AI 共用)
     * (此處紀錄完整日誌)
     */
    function applyMoveToBoard(dotA, dotB, player) {
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
                    lines[id].player = player;
                    newSegmentDrawn = true;
                } else if (lines[id].player !== 0 && lines[id].player !== player) {
                    if (lines[id].sharedBy === 0) {
                        lines[id].sharedBy = player;
                    }
                }
            }
        }

        if (!newSegmentDrawn) {
            return { newSegmentDrawn: false, gameEnded: false };
        }

        // 紀錄得分詳情
        const scoreBefore = scores[player];
        let totalFilledThisGame = 0;
        let completedTrianglesInfo = []; // 儲存完成的三角形資訊

        triangles.forEach(tri => {
            if (!tri.filled) {
                const isComplete = tri.lineKeys.every(key => lines[key] && lines[key].drawn);
                if (isComplete) {
                    tri.filled = true;
                    tri.player = player;
                    scores[player]++;
                    
                    // 紀錄完成的三角形
                    const triDots = tri.dots.map(d => `(${d.r},${d.c})`).join(' | ');
                    completedTrianglesInfo.push({
                        dots: triDots,
                        lines: tri.lineKeys
                    });
                    
                    const scoreBox = (player === 1) ? player1ScoreBox : player2ScoreBox;
                    scoreBox.classList.add('score-pulse');
                    setTimeout(() => {
                        scoreBox.classList.remove('score-pulse');
                    }, 400); 
                }
            }
            if (tri.filled) totalFilledThisGame++;
        });

        // 儲存本輪紀錄
        const scoreAfter = scores[player];
        const scoreGained = scoreAfter - scoreBefore;
        
        // 判斷玩家類型
        let playerType = "Human";
        if (gameMode === 2) { // 電腦 vs 電腦
            playerType = "AI";
        } else if (gameMode === 1 && player === 2) { // 玩家 vs 電腦 (P2是AI)
            playerType = "AI";
        }
        
        const logEntry = {
            turn: turnCounter,
            player: player,
            playerType: playerType, 
            move: `(${dotA.r},${dotA.c}) to (${dotB.r},${dotB.c})`,
            segmentsDrawn: segmentIds, 
            scoreGained: scoreGained,
            trianglesCompleted: completedTrianglesInfo, 
            newScoreP1: scores[1],
            newScoreP2: scores[2]
        };
        gameHistoryLog.turns.push(logEntry); // 存入 turns 陣列
        turnCounter++; // 移至下一輪
        
        return {
            newSegmentDrawn: true,
            gameEnded: (totalFilledThisGame === totalTriangles)
        };
    }
    
    // (輔助函式：安全地處理 CSV 字串)
    function escapeCSV(str) {
        if (str === null || str === undefined) return '';
        let result = String(str);
        
        // 將內部的雙引號 ("") 替換為兩個雙引號 ("""")
        result = result.replace(/"/g, '""');
        
        // 如果字串包含逗號、換行符或剛被處理過的雙引號，則整個用雙引號包起來
        if (result.includes(',') || result.includes('\n') || result.includes('"')) {
            return `"${result}"`;
        }
        
        return result;
    }

    // 匯出遊戲紀錄 (CSV/Excel)
    function exportGameLog() {
        if (!gameHistoryLog.turns || gameHistoryLog.turns.length === 0) {
            alert("尚未有任何遊戲紀錄。");
            return;
        }

        // CSV 標頭
        const headers = [
            "Turn", "Player", "PlayerType", "Move (r,c)", 
            "SegmentsDrawn (ID)", "ScoreThisTurn", "TrianglesCompleted (Dots)",
            "P1_TotalScore", "P2_TotalScore"
        ];
        
        // \uFEFF 是 BOM (Byte Order Mark)，確保 Excel 能正確讀取 UTF-8 (包含中文)
        let csvContent = "\uFEFF"; 

        // 加入遊戲設定 (作為註解)
        csvContent += "# 遊戲設定\n";
        csvContent += `# 棋盤大小: ${gameHistoryLog.settings.boardSize}\n`;
        csvContent += `# 連線格數: ${gameHistoryLog.settings.lineLength}\n`;
        csvContent += `# 遊戲模式: ${escapeCSV(gameHistoryLog.settings.gameMode)}\n`; // 模式名稱可能包含 V.S.
        csvContent += `# 紀錄時間: ${gameHistoryLog.settings.dateTime}\n\n`;

        // 加入表格標頭
        csvContent += headers.join(",") + "\n";

        // 加入每一輪的數據
        gameHistoryLog.turns.forEach(entry => {
            // 將陣列資料扁平化為單一字串，用分號 (;) 分隔
            const segmentsStr = entry.segmentsDrawn.join('; ');
            const trianglesStr = entry.trianglesCompleted.map(t => t.dots).join('; ');

            const row = [
                entry.turn,
                entry.player,
                escapeCSV(entry.playerType),
                escapeCSV(entry.move),
                escapeCSV(segmentsStr), 
                entry.scoreGained,
                escapeCSV(trianglesStr), 
                entry.newScoreP1,
                entry.newScoreP2
            ];
            csvContent += row.join(",") + "\n";
        });

        // 加入遊戲總結 (作為註解)
        if (gameHistoryLog.summary.winnerMessage) {
            csvContent += "\n# 遊戲總結\n";
            csvContent += `# 勝利訊息: ${escapeCSV(gameHistoryLog.summary.winnerMessage)}\n`;
            csvContent += `# P1 最終分數: ${gameHistoryLog.summary.finalScoreP1}\n`;
            csvContent += `# P2 最終分數: ${gameHistoryLog.summary.finalScoreP2}\n`;
        }

        // 建立 Blob 並觸發下載
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);

        // 產生檔案名稱
        const date = new Date(gameHistoryLog.settings.dateTime);
        const timestamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
        // 檔名使用 .csv
        link.setAttribute("download", `triangle_game_log_${timestamp}.csv`);
        
        document.body.appendChild(link); 
        link.click(); // 模擬點擊
        
        // 清理
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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
    
    if (gameModeSelect) gameModeSelect.addEventListener('change', initGame);
    if (boardSizeSelect) boardSizeSelect.addEventListener('change', initGame);
    if (lineLengthSelect) lineLengthSelect.addEventListener('change', initGame);
    
    // 綁定匯出按鈕
    if (exportLogButton) exportLogButton.addEventListener('click', exportGameLog);

    // 啟動遊戲
    initGame();
});
