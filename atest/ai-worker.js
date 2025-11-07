/**
 * ============================================
 * AI Web Worker (ai-worker.js)
 * * 包含所有 AI 運算邏輯:
 * 1. Minimax 演算法
 * 2. 迭代加深 (Iterative Deepening)
 * 3. 置換表 (Transposition Table)
 * 4. 啟發式評估 (Heuristic)
 * ============================================
 */

// --- 1. AI 核心變數 ---
let transpositionTable = new Map();
let dots = [];
let totalTriangles = 0;
let REQUIRED_LINE_LENGTH = 1;

// --- 2. 訊息處理 ---

// 接收來自主線程的訊息
self.onmessage = (e) => {
    const data = e.data;

    if (data.command === 'start') {
        // 更新遊戲狀態
        dots = data.gameState.dots;
        totalTriangles = data.gameState.totalTriangles;
        REQUIRED_LINE_LENGTH = data.gameState.requiredLineLength;

        // 清空置換表
        transpositionTable.clear();
        logToMain(`--- [Worker] 置換表已清除 ---`);

        // 開始運算
        const bestMove = findBestAIMove(
            data.gameState.lines, 
            data.gameState.triangles, 
            data.gameState.player
        );
        
        // 運算完成後，將結果傳回主線程
        self.postMessage({
            type: 'result',
            bestMove: bestMove
        });
    }
};

// 將日誌訊息傳回主線程
function logToMain(message) {
    self.postMessage({
        type: 'log',
        message: message
    });
}

// 將中途找到的最佳解傳回主線程 (用於迭代加深)
function postIntermediateResult(move, depth, score) {
    self.postMessage({
        type: 'progress',
        message: `[Worker] 深度 ${depth} 完成。 評分: ${score.toFixed(0)}`,
        bestMove: move // (目前主線程尚未使用此中途解)
    });
}

// --- 3. 遊戲邏輯輔助函式 (從 script.js 搬移) ---

// (這些函式 AI 運算時需要)
function getLineId(dot1, dot2) {
    if (!dot1 || !dot2) return null;
    let d1 = dot1, d2 = dot2;
    if (dot1.r > dot2.r || (dot1.r === dot2.r && dot1.c > dot2.c)) {
        d1 = dot2;
        d2 = dot1;
    }
    return `${d1.r},${d1.c}_${d2.r},${d2.c}`;
}
function isClose(val, target, tolerance = 1.5) {
    return Math.abs(val - target) < tolerance;
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
function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// --- 4. AI 核心邏輯 ---

/**
 * (新功能) 取得棋盤狀態的雜湊值 (Hash)
 * 用於置換表 (Transposition Table)
 */
function getBoardHash(lines, triangles, player) {
    // 簡易的狀態雜湊：
    // L: [id:player:sharedBy]
    // T: [idx:player]
    // P: player
    let lineHash = "";
    // (優化：使用 Object.keys 迭代 lines)
    for (const id of Object.keys(lines)) {
        if (lines[id].drawn) {
            lineHash += `L${id}${lines[id].player}${lines[id].sharedBy};`;
        }
    }
    let triHash = "";
    triangles.forEach((tri, idx) => {
        if (tri.filled) {
            triHash += `T${idx}${tri.player};`;
        }
    });
    return lineHash + triHash + `P${player}`;
}

/**
 * (新功能) 模擬走一步
 * (優化: 不再使用 deepCopy，改為手動修改和還原，提升效能)
 * (註：為求穩定，此處仍保留 deepCopy，效能優化版的 move/unmove 更複雜)
 */
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
    if (!newSegmentDrawn) return null; 

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


/**
 * (新功能) 更精細的啟發式評估 (Better Heuristic)
 */
function evaluateBoard(currentLines, currentTriangles) {
    let p2Score = 0; // AI (Max) 分數
    let p1Score = 0; // Human (Min) 分數
    
    // (新) 威脅 (送分給對手)
    let p1Threats = 0; // P1 (Min) 製造的威脅 (P2 可得分)
    let p2Threats = 0; // P2 (Max) 製造的威脅 (P1 可得分)

    // (新) 雙重威脅 (一石二鳥)
    let p1DoubleSetups = 0;
    let p2DoubleSetups = 0;
    
    // 檢查所有三角形
    currentTriangles.forEach((tri, triIndex) => {
        if (tri.filled) {
            if (tri.player === 2) p2Score++;
            else p1Score++;
        } else {
            // 檢查"聽牌" (差一條線)
            let drawnCount = 0;
            let undrawnKey = null;
            let p1Lines = 0;
            let p2Lines = 0;

            tri.lineKeys.forEach(key => {
                if (currentLines[key] && currentLines[key].drawn) {
                    drawnCount++;
                    if (currentLines[key].player === 1) p1Lines++;
                    if (currentLines[key].player === 2) p2Lines++;
                    // (共享線也算)
                    if (currentLines[key].sharedBy === 1) p1Lines++;
                    if (currentLines[key].sharedBy === 2) p2Lines++;
                } else {
                    undrawnKey = key;
                }
            });

            if (drawnCount === 2) {
                // 這是一個 "威脅" (setup)
                // 檢查這條 "undrawnKey" 是否也完成了 *另一個* 三角形
                let completesTwo = false;
                currentTriangles.forEach((otherTri, otherTriIndex) => {
                    // (確保不是同一個三角形，且另一個也未填滿，且包含同一條線)
                    if (otherTriIndex !== triIndex && !otherTri.filled && otherTri.lineKeys.includes(undrawnKey)) {
                        let otherDrawnCount = 0;
                        otherTri.lineKeys.forEach(okey => {
                            if (currentLines[okey] && currentLines[okey].drawn) {
                                otherDrawnCount++;
                            }
                        });
                        if (otherDrawnCount === 2) {
                            completesTwo = true;
                        }
                    }
                });


                // 評估這個威脅屬於誰
                if (p1Lines > p2Lines) { 
                    // P1 製造的威脅 (P2 可以來得分)
                    p1Threats++;
                    if (completesTwo) p1DoubleSetups++;
                }
                else if (p2Lines > p1Lines) { 
                    // P2 製造的威脅 (P1 可以來得分)
                    p2Threats++;
                    if (completesTwo) p2DoubleSetups++;
                }
                // (如果 p1Lines == p2Lines，通常是共享線造成的，算是中性威脅)
            }
        }
    });

    // 檢查遊戲是否結束
    let totalFilled = p1Score + p2Score;
    if (totalFilled === totalTriangles) {
        if (p2Score > p1Score) return 1000000; // P2 獲勝 (極高分)
        if (p1Score > p2Score) return -1000000; // P1 獲勝 (極低分)
        return 0; // 平手
    }

    // --- 總評分 (P2 是 Maximizer) ---
    // 基礎分: (P2 得分 - P1 得分) * 100
    // 威脅分:
    //  - P1 製造的威脅 (p1Threats)，P2 能得分，對 P2 (Max) 是 *好事*
    //  - P2 製造的威脅 (p2Threats)，P1 能得分，對 P2 (Max) 是 *壞事*
    // 雙重威脅的權重更高
    
    return (p2Score * 100 - p1Score * 100) +
           (p1Threats * 10 - p2Threats * 10) +
           (p1DoubleSetups * 50 - p2DoubleSetups * 50);
}

/**
 * 找出所有可能的走法
 */
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

/**
 * (新功能) Minimax 演算法核心 (整合置換表)
 */
const TT_FLAG_EXACT = 0;
const TT_FLAG_LOWERBOUND = 1; // Alpha
const TT_FLAG_UPPERBOUND = 2; // Beta

function minimax(currentLines, currentTriangles, depth, isMaximizingPlayer, alpha, beta) {
    
    // 1. 檢查置換表
    const boardHash = getBoardHash(currentLines, currentTriangles, isMaximizingPlayer ? 2 : 1);
    const ttEntry = transpositionTable.get(boardHash);
    
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === TT_FLAG_EXACT) {
            return ttEntry.score;
        } else if (ttEntry.flag === TT_FLAG_LOWERBOUND) {
            alpha = Math.max(alpha, ttEntry.score);
        } else if (ttEntry.flag === TT_FLAG_UPPERBOUND) {
            beta = Math.min(beta, ttEntry.score);
        }
        if (alpha >= beta) {
            return ttEntry.score;
        }
    }
    
    // 2. 檢查目前是否為終局 (使用新的評估函式)
    const currentEval = evaluateBoard(currentLines, currentTriangles);
    if (Math.abs(currentEval) >= 1000000) { // 遊戲結束
        if (currentEval > 0) return currentEval + depth; // 越快贏越好
        return currentEval - depth; // 越慢輸越好
    }
    
    // 3. 找到所有可能的下一步
    const allMoves = findAllValidMoves(currentLines);

    // 4. 終止條件 (達到最大深度 或 無棋可走)
    if (depth === 0 || allMoves.length === 0) {
        return currentEval;
    }
    
    // 5. 走法排序 (淺層排序)
    // (為加速，此處暫不排序子節點，僅排序根節點)

    let bestValue;
    let ttFlag = TT_FLAG_EXACT; // 預設為 Alpha < score < Beta

    if (isMaximizingPlayer) { // P2 (AI) 的回合 (Maximizer)
        bestValue = -Infinity; 
        
        for (const move of allMoves) {
            const sim = simulateMove(move, currentLines, currentTriangles, 2); // 2 = P2
            if (!sim) continue;
            
            const immediateScore = sim.scoreGained * 1000;
            const futureValue = minimax(sim.newLines, sim.newTriangles, depth - 1, false, alpha, beta);
            const totalValue = immediateScore + futureValue; 

            bestValue = Math.max(bestValue, totalValue);
            alpha = Math.max(alpha, bestValue); 
            
            if (beta <= alpha) {
                ttFlag = TT_FLAG_LOWERBOUND; // 發生 Beta 剪枝，分數至少有 bestValue
                break; 
            }
        }
    } else { // P1 (玩家或 AI) 的回合 (Minimizer)
        bestValue = +Infinity; 

        for (const move of allMoves) {
            const sim = simulateMove(move, currentLines, currentTriangles, 1); // 1 = P1
            if (!sim) continue;
            
            const immediateScore = sim.scoreGained * 1000; 
            const futureValue = minimax(sim.newLines, sim.newTriangles, depth - 1, true, alpha, beta); 
            const totalValue = -immediateScore + futureValue; // P1 得分對 P2 是負分

            bestValue = Math.min(bestValue, totalValue);
            beta = Math.min(beta, bestValue); 
            
            if (beta <= alpha) {
                ttFlag = TT_FLAG_UPPERBOUND; // 發生 Alpha 剪枝，分數最多只有 bestValue
                break; 
            }
        }
    }
    
    // 6. 儲存到置換表
    transpositionTable.set(boardHash, {
        score: bestValue,
        depth: depth,
        flag: ttFlag
    });
    
    return bestValue;
}

/**
 * (新功能) 動態搜尋深度
 * (與 a/script.js 相同)
 */
function getAIDepth() {
    switch (REQUIRED_LINE_LENGTH) {
        case 1: return 5; 
        case 2: return 6;
        case 3: return 7;
        case 4: case 5: return 8;
        default: return 6;
    }
}

/**
 * (新功能) AI "大腦" (整合迭代加深)
 */
function findBestAIMove(currentLines, currentTriangles, player) {
    const isMaximizingPlayer = (player === 2);
    const playerName = isMaximizingPlayer ? "AI 2 (Max)" : "AI 1 (Min)";
    
    const MAX_DEPTH = getAIDepth();
    logToMain(`--- ${playerName} 開始思考 (最大深度: ${MAX_DEPTH}) ---`);
    
    let allMoves = findAllValidMoves(currentLines); 
    if (allMoves.length === 0) {
        logToMain(`--- ${playerName} 找不到可走的步 ---`);
        return null; 
    }

    // 走法排序 (Move Ordering) - 深度 0 排序
    let scoredMoves = allMoves.map(move => {
        const sim = simulateMove(move, currentLines, currentTriangles, player);
        if (!sim) return { move, value: -Infinity }; 
        const immediateScore = sim.scoreGained * 1000;
        const futureEval = evaluateBoard(sim.newLines, sim.newTriangles); 
        let totalValue;
        if (isMaximizingPlayer) {
            totalValue = immediateScore + futureEval; // P2
        } else {
            totalValue = -immediateScore + futureEval; // P1
        }
        return { move, value: totalValue };
    });

    if (isMaximizingPlayer) scoredMoves.sort((a, b) => b.value - a.value); // 高 -> 低
    else scoredMoves.sort((a, b) => a.value - b.value); // 低 -> 高
    
    // (新) 迭代加深 (Iterative Deepening)
    let bestMove = null;
    let bestValue = isMaximizingPlayer ? -Infinity : +Infinity;

    for (let currentDepth = 1; currentDepth <= MAX_DEPTH; currentDepth++) {
        
        let alpha = -Infinity;
        let beta = +Infinity;
        let currentBestMoveForDepth = null;
        let currentBestValueForDepth = isMaximizingPlayer ? -Infinity : +Infinity;

        // (優化：使用上一輪找到的最佳走法，優先搜尋它)
        // 建立一個排序過的陣列，將 'bestMove' (上一輪的解) 放到最前面
        const movesToSearch = Array.from(scoredMoves);
        if (bestMove) {
            movesToSearch.sort((a, b) => {
                if (a.move.dot1.r === bestMove.dot1.r && a.move.dot1.c === bestMove.dot1.c && a.move.dot2.r === bestMove.dot2.r && a.move.dot2.c === bestMove.dot2.c) return -1;
                if (b.move.dot1.r === bestMove.dot1.r && b.move.dot1.c === bestMove.dot1.c && b.move.dot2.r === bestMove.dot2.r && b.move.dot2.c === bestMove.dot2.c) return 1;
                return 0; // (維持原本的排序)
            });
        }

        for (const scoredMove of movesToSearch) {
            const move = scoredMove.move;
            const sim = simulateMove(move, currentLines, currentTriangles, player);
            if (!sim) continue; 
            const immediateScore = sim.scoreGained * 1000;
            
            // (我們從 D-1 開始搜尋)
            const futureValue = minimax(sim.newLines, sim.newTriangles, currentDepth - 1, !isMaximizingPlayer, alpha, beta);
            
            let totalMoveValue;
            if (isMaximizingPlayer) {
                totalMoveValue = immediateScore + futureValue;
                if (totalMoveValue > currentBestValueForDepth) {
                    currentBestValueForDepth = totalMoveValue;
                    currentBestMoveForDepth = move;
                }
                alpha = Math.max(alpha, currentBestValueForDepth);
            } else { // isMinimizingPlayer
                totalMoveValue = -immediateScore + futureValue;
                if (totalMoveValue < currentBestValueForDepth) {
                    currentBestValueForDepth = totalMoveValue;
                    currentBestMoveForDepth = move;
                }
                beta = Math.min(beta, currentBestValueForDepth);
            }
        }
        
        // 儲存這一輪 (深度) 找到的最佳解
        bestMove = currentBestMoveForDepth;
        bestValue = currentBestValueForDepth;
        
        // 回報中途進度
        postIntermediateResult(bestMove, currentDepth, bestValue);

        // (優化: 如果找到必勝/必敗，可以提早中止)
        if (Math.abs(bestValue) >= (1000000 - MAX_DEPTH)) {
            logToMain(`--- ${playerName} 找到必勝/必敗解 (深度 ${currentDepth}) ---`);
            break;
        }
    }
    
    if (bestMove) {
        logToMain(`--- ${playerName} 決定走法: (${bestMove.dot1.r},${bestMove.dot1.c})-(${bestMove.dot2.r},${bestMove.dot2.c}) | 評分: ${bestValue.toFixed(0)} ---`);
    } else {
         logToMain(`--- ${playerName} 最終沒有選擇任何走法 ---`);
    }
    
    return bestMove;
}