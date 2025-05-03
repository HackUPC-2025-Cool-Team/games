import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as math from 'mathjs'; // Using mathjs for vector operations if needed, or stick to Math

const WIDTH = 800;
const HEIGHT = 800;
const FPS = 45; // Target FPS for game loop interval
const BALL_RADIUS = 10;
const BALL_SPEED = 5; // Adjusted speed for JS timing
const PADDLE_LENGTH = 100;
const PADDLE_WIDTH = 10;
const RADIUS_BASE = 300; // Base radius for the arena
const PADDLE_SPEED = 20; // How much offset changes per input tick
const MAX_PLAYERS = 6;
const WAIT_TIME_MS = 3000; // 3 seconds
const MARGIN = 50; // Margin for 2-player mode arena
const MAX_INITIAL_ANGLE_VERTICALITY = Math.PI / 3; // Max 60 degrees from horizontal

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']; // Hex colors

const wss = new WebSocketServer({ port: 8081 }); // Use a different port than snake game
const clients = new Map(); // ws -> player data
let gameState = {
    players: {}, // { playerId: { id, color, offset, alive, ws } }
    ball: {
        pos: { x: WIDTH / 2, y: HEIGHT / 2 },
        angle: generateAllowedAngle(), // Use the new function for initial angle
    },
    arena: {
        verts: [], // Vertices of the playing field polygon
        sides: [], // [{ p1: {x,y}, p2: {x,y}, player: playerId }] - segments for collision
        paddles: [], // [{ p1: {x,y}, p2: {x,y}, player: playerId, color }] - actual paddle lines
    },
    winner: null,
    gameActive: false,
    waitingForPlayers: false, // New state to track waiting period
    startTime: null, // Track when the game should start
};
let gameStartTimeout = null; // Timeout handle

console.log('N-Pon WebSocket server started on port 8081');

// Function to generate a random angle avoiding steep vertical angles
function generateAllowedAngle() {
    let angle;
    const range1 = MAX_INITIAL_ANGLE_VERTICALITY; // [0, pi/3]
    const range2 = Math.PI - MAX_INITIAL_ANGLE_VERTICALITY; // [2pi/3, pi]
    const range3 = Math.PI + MAX_INITIAL_ANGLE_VERTICALITY; // [pi, 4pi/3]
    const range4 = 2 * Math.PI - MAX_INITIAL_ANGLE_VERTICALITY; // [5pi/3, 2pi]

    // Total size of allowed ranges: (pi/3) + (pi - 2pi/3) + (4pi/3 - pi) + (2pi - 5pi/3) = pi/3 + pi/3 + pi/3 + pi/3 = 4pi/3
    const totalAllowedRange = (4 * Math.PI) / 3;

    // Generate random value within the total allowed range size
    const rand = Math.random() * totalAllowedRange;

    if (rand < range1) { // Map to [0, pi/3]
        angle = rand;
    } else if (rand < range1 + (range2 - (Math.PI - range1))) { // Map to [2pi/3, pi]
        // Size of this range is pi/3
        angle = rand + (Math.PI - range1) - range1; // Add the gap (pi/3)
        angle = rand + (2 * Math.PI / 3); // Simplified: rand is in [pi/3, 2pi/3), map to [2pi/3, pi)
    } else if (rand < range1 + (range2 - (Math.PI - range1)) + (range3 - Math.PI)) { // Map to [pi, 4pi/3]
         // Size of this range is pi/3
         // rand is in [2pi/3, pi), map to [pi, 4pi/3)
         angle = rand + (Math.PI - (2*Math.PI/3)) + (Math.PI - (2*Math.PI/3)); // Add the two gaps (pi/3 + pi/3)
         angle = rand + (2 * Math.PI / 3); // Simplified: rand is in [2pi/3, pi), map to [pi, 4pi/3)
    } else { // Map to [5pi/3, 2pi]
        // Size of this range is pi/3
        // rand is in [pi, 4pi/3), map to [5pi/3, 2pi)
        angle = rand + (Math.PI - (2*Math.PI/3)) + (Math.PI - (2*Math.PI/3)) + (Math.PI - (2*Math.PI/3)); // Add three gaps (pi/3 * 3)
        angle = rand + Math.PI; // Simplified: rand is in [pi, 4pi/3), map to [5pi/3, 2pi)
    }

     // Alternative simpler mapping logic:
     const randSegment = Math.random(); // Random number 0 to 1
     const baseAngle = (randSegment * totalAllowedRange) - (2*Math.PI/3); // Generate angle in [-2pi/3, 2pi/3]
     // Shift positive angles if needed
     if (baseAngle >= 0) {
         angle = baseAngle; // Already in [-2pi/3, 2pi/3], positive part is [0, 2pi/3] -> WRONG, need [-pi/3, pi/3]
     } else {
         angle = baseAngle + Math.PI; // Map negative part [-2pi/3, 0) to [pi/3, pi) -> WRONG
     }

     // --- Let's try the loop method for simplicity and correctness ---
     let validAngle = false;
     while (!validAngle) {
         angle = Math.random() * 2 * Math.PI;
         const normalizedAngle = (angle + Math.PI) % (2 * Math.PI) - Math.PI; // Normalize to [-PI, PI]

         // Check if NOT in the forbidden zones: (pi/3, 2pi/3) and (-2pi/3, -pi/3)
         const forbiddenUpper = normalizedAngle > MAX_INITIAL_ANGLE_VERTICALITY && normalizedAngle < Math.PI - MAX_INITIAL_ANGLE_VERTICALITY;
         const forbiddenLower = normalizedAngle < -MAX_INITIAL_ANGLE_VERTICALITY && normalizedAngle > -Math.PI + MAX_INITIAL_ANGLE_VERTICALITY;

         if (!forbiddenUpper && !forbiddenLower) {
             validAngle = true;
         }
     }
     return angle;
}

function resetBall() {
    gameState.ball.pos = { x: WIDTH / 2, y: HEIGHT / 2 };
    gameState.ball.angle = generateAllowedAngle(); // Use the new function here too
}

function startGame() {
    console.log("Starting game now!");
    clearTimeout(gameStartTimeout);
    gameStartTimeout = null;
    gameState.waitingForPlayers = false;
    gameState.gameActive = true;
    gameState.startTime = null; // Clear start time
    resetBall();
    updateArena(); // Final arena update before starting
    broadcastGameState();
}

function updateArena() {
    const alivePlayers = Object.values(gameState.players).filter(p => p.alive);
    const n = alivePlayers.length;
    gameState.arena.verts = []; // Clear previous geometry
    gameState.arena.sides = [];
    gameState.arena.paddles = [];
    // Don't reset winner here, only when game actually restarts or player eliminated

    // --- Geometry Calculation based on n ---
    if (n === 2) {
        // *** ALWAYS Calculate 2-Player Pong Layout when n=2 ***
        console.log("Updating arena for 2 players (Pong layout)");
        const [p1, p2] = alivePlayers; // Get the two players

        // Define vertical sides
        const side1 = { p1: { x: MARGIN, y: MARGIN }, p2: { x: MARGIN, y: HEIGHT - MARGIN }, player: p1.id };
        const side2 = { p1: { x: WIDTH - MARGIN, y: MARGIN }, p2: { x: WIDTH - MARGIN, y: HEIGHT - MARGIN }, player: p2.id };
        gameState.arena.sides.push(side1, side2);

        // Calculate paddles for player 1 (left)
        const maxOffsetY = (HEIGHT - 2 * MARGIN - PADDLE_LENGTH) / 2;
        p1.offset = p1.offset || 0;
        const clampedOffset1 = Math.max(-maxOffsetY, Math.min(maxOffsetY, p1.offset));
        p1.offset = clampedOffset1; // Update player state with clamped value
        const paddleCenterY1 = HEIGHT / 2 + clampedOffset1;
        gameState.arena.paddles.push({
            p1: { x: MARGIN, y: paddleCenterY1 - PADDLE_LENGTH / 2 },
            p2: { x: MARGIN, y: paddleCenterY1 + PADDLE_LENGTH / 2 },
            player: p1.id,
            color: p1.color,
        });

        // Calculate paddles for player 2 (right)
        p2.offset = p2.offset || 0;
        const clampedOffset2 = Math.max(-maxOffsetY, Math.min(maxOffsetY, p2.offset));
        p2.offset = clampedOffset2; // Update player state with clamped value
        const paddleCenterY2 = HEIGHT / 2 + clampedOffset2;
        gameState.arena.paddles.push({
            p1: { x: WIDTH - MARGIN, y: paddleCenterY2 - PADDLE_LENGTH / 2 },
            p2: { x: WIDTH - MARGIN, y: paddleCenterY2 + PADDLE_LENGTH / 2 },
            player: p2.id,
            color: p2.color,
        });
        // Vertices aren't really used in 2p mode, but can define the corners
        gameState.arena.verts.push(side1.p1, side1.p2, side2.p2, side2.p1);

    } else if (n > 2) {
         // *** ALWAYS Calculate N-Player Polygon Layout when n > 2 ***
        console.log(`Updating arena for ${n} players (Polygon layout)`);
        const center = { x: WIDTH / 2, y: HEIGHT / 2 };
        const currentRadius = RADIUS_BASE;

        // Calculate polygon vertices
        for (let i = 0; i < n; i++) {
            const angle = (2 * Math.PI * i) / n - Math.PI / 2; // Start from top
            gameState.arena.verts.push({
                x: center.x + Math.cos(angle) * currentRadius,
                y: center.y + Math.sin(angle) * currentRadius,
            });
        }

        // Calculate sides and paddles
        for (let i = 0; i < n; i++) {
            const p = alivePlayers[i];
            const v1 = gameState.arena.verts[i];
            const v2 = gameState.arena.verts[(i + 1) % n];

            const dx = v2.x - v1.x;
            const dy = v2.y - v1.y;
            const sideLength = Math.hypot(dx, dy);
            const unitX = dx / sideLength;
            const unitY = dy / sideLength;

            const midX = (v1.x + v2.x) / 2;
            const midY = (v1.y + v2.y) / 2;

            const maxOffset = (sideLength - PADDLE_LENGTH) / 2;
            p.offset = p.offset || 0;
            const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, p.offset));
            p.offset = clampedOffset; // Update player offset state

            const paddleCenterX = midX + unitX * clampedOffset;
            const paddleCenterY = midY + unitY * clampedOffset;

            const paddleStartX = paddleCenterX - unitX * (PADDLE_LENGTH / 2);
            const paddleStartY = paddleCenterY - unitY * (PADDLE_LENGTH / 2);
            const paddleEndX = paddleCenterX + unitX * (PADDLE_LENGTH / 2);
            const paddleEndY = paddleCenterY + unitY * (PADDLE_LENGTH / 2);

            gameState.arena.sides.push({ p1: v1, p2: v2, player: p.id });
            gameState.arena.paddles.push({
                p1: { x: paddleStartX, y: paddleStartY },
                p2: { x: paddleEndX, y: paddleEndY },
                player: p.id,
                color: p.color,
            });
        }
    }
    // Else (n < 2), the arena remains empty (cleared at the start)

    // --- Game State Logic (Countdown, Active State) ---
    if (n < 2) {
        // Not enough players, stop any pending game start and reset state
        if (gameStartTimeout) {
            console.log("Not enough players, cancelling any pending start.");
            clearTimeout(gameStartTimeout);
            gameStartTimeout = null;
        }
        gameState.gameActive = false;
        gameState.waitingForPlayers = false;
        gameState.startTime = null;
        gameState.winner = null; // Reset winner if game stops
        console.log("Waiting for more players...");
    } else { // n >= 2
        // Handle countdown logic (only if not already active and not already waiting)
        if (!gameState.gameActive && !gameState.waitingForPlayers) {
            console.log(`Got ${n} players. Starting ${WAIT_TIME_MS / 1000}s countdown...`);
            gameState.waitingForPlayers = true;
            gameState.startTime = Date.now() + WAIT_TIME_MS;
            gameState.winner = null; // Reset winner before starting countdown
            if (gameStartTimeout) clearTimeout(gameStartTimeout); // Clear any existing just in case
            gameStartTimeout = setTimeout(startGame, WAIT_TIME_MS);
        } else if (gameState.waitingForPlayers && !gameState.gameActive) {
            // If already waiting, just log update (e.g., player joined/left during countdown)
            // Ensure countdown wasn't cancelled by dropping below 2 players
            if (!gameStartTimeout) {
                 console.log("Countdown was cancelled but state wasn't fully reset. Resetting wait.");
                 gameState.waitingForPlayers = false;
                 gameState.startTime = null;
                 // Re-trigger countdown if needed by calling updateArena again, but avoid infinite loop
                 // This case should ideally be handled by the n < 2 logic above.
            } else {
                 console.log(`Player count changed during countdown. ${n} players now. Game starts at ${new Date(gameState.startTime).toLocaleTimeString()}`);
            }
        }
        // If gameState.gameActive is true, we don't need to do anything here regarding countdown/wait state.
    }
}

// Simple point-to-line segment distance
function pointLineSegmentDistance(p, a, b) {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const closestX = a.x + t * (b.x - a.x);
    const closestY = a.y + t * (b.y - a.y);
    return Math.hypot(p.x - closestX, p.y - closestY);
}

// Reflect ball angle based on surface normal
function reflectBall(paddle, numAlive) { // Added numAlive parameter
    let normalX, normalY;

    if (numAlive === 2) {
        // For vertical paddles, normal is purely horizontal
        // Assume paddle.p1.x determines if it's left or right paddle
        normalX = (paddle.p1.x < WIDTH / 2) ? 1 : -1; // Normal points away from center
        normalY = 0;
    } else {
        // Original logic for polygon sides
        const dx = paddle.p2.x - paddle.p1.x;
        const dy = paddle.p2.y - paddle.p1.y;
        // Normal vector (nx, ny) - perpendicular to the paddle, pointing outwards
        // Need to determine outward direction relative to polygon center
        const midX = (paddle.p1.x + paddle.p2.x) / 2;
        const midY = (paddle.p1.y + paddle.p2.y) / 2;
        const center = { x: WIDTH / 2, y: HEIGHT / 2 };
        const vecCenterX = midX - center.x;
        const vecCenterY = midY - center.y;

        let nx = -dy;
        let ny = dx;
        // Ensure normal points outwards by checking dot product with vector from center
        if (nx * vecCenterX + ny * vecCenterY < 0) {
            nx = -nx; // Flip normal
            ny = -ny;
        }

        const normMag = Math.hypot(nx, ny);
        if (normMag === 0) return; // Avoid division by zero
        normalX = nx / normMag;
        normalY = ny / normMag;
    }


    const vx = Math.cos(gameState.ball.angle);
    const vy = Math.sin(gameState.ball.angle);

    // Reflection formula: r = v - 2 * dot(v, n) * n
    const dotProduct = vx * normalX + vy * normalY;

    // Ensure ball is moving towards the paddle before reflecting
    if (dotProduct >= 0) {
         // console.log("Skipping reflection: Ball not moving towards paddle.");
         return; // Avoid reflecting if ball is already moving away
    }

    const reflectX = vx - 2 * dotProduct * normalX;
    const reflectY = vy - 2 * dotProduct * normalY;

    gameState.ball.angle = Math.atan2(reflectY, reflectX);

    // Add slight random angle change to prevent infinite loops
    gameState.ball.angle += (Math.random() - 0.5) * 0.1;
    // Ensure angle stays within [-PI, PI] or [0, 2PI] if needed, atan2 handles this
}


function gameLoop() {
    // Only run game logic if the game is actually active
    if (!gameState.gameActive) {
        // If waiting, just broadcast state. If not waiting and not active, updateArena might trigger wait.
        if (!gameState.waitingForPlayers) {
             updateArena(); // Check if enough players have joined to start waiting
        }
        broadcastGameState(); // Keep clients updated on waiting status or player changes
        return;
    }

    // 1. Move Ball
    gameState.ball.pos.x += BALL_SPEED * Math.cos(gameState.ball.angle);
    gameState.ball.pos.y += BALL_SPEED * Math.sin(gameState.ball.angle);

    const currentAlivePlayers = Object.values(gameState.players).filter(p => p.alive);
    const numAlive = currentAlivePlayers.length;

    // 1.5 Check Top/Bottom Wall Collisions (Only for 2-player mode)
    if (numAlive === 2) {
        if (gameState.ball.pos.y < MARGIN + BALL_RADIUS) {
            gameState.ball.pos.y = MARGIN + BALL_RADIUS; // Prevent sticking
            gameState.ball.angle = -gameState.ball.angle; // Reflect angle vertically
            gameState.ball.angle += (Math.random() - 0.5) * 0.05; // Add slight randomness
        } else if (gameState.ball.pos.y > HEIGHT - MARGIN - BALL_RADIUS) {
            gameState.ball.pos.y = HEIGHT - MARGIN - BALL_RADIUS; // Prevent sticking
            gameState.ball.angle = -gameState.ball.angle; // Reflect angle vertically
            gameState.ball.angle += (Math.random() - 0.5) * 0.05; // Add slight randomness
        }
        // Normalize angle to be within [0, 2*PI) - helps prevent potential issues
        gameState.ball.angle = (gameState.ball.angle + 2 * Math.PI) % (2 * Math.PI);
    }


    // 2. Check Paddle Collisions
    let collisionOccurred = false;
    // const currentAlivePlayers = Object.values(gameState.players).filter(p => p.alive); // Already defined above
    // const numAlive = currentAlivePlayers.length; // Already defined above

    for (const paddle of gameState.arena.paddles) {
        const dist = pointLineSegmentDistance(gameState.ball.pos, paddle.p1, paddle.p2);
        // Use a slightly larger collision threshold for flat paddles
        const collisionThreshold = (numAlive === 2) ? BALL_RADIUS + PADDLE_WIDTH / 2 : BALL_RADIUS;
        if (dist <= collisionThreshold) {
            reflectBall(paddle, numAlive); // Pass numAlive to reflectBall
            // Move ball slightly away to prevent sticking
            gameState.ball.pos.x += Math.cos(gameState.ball.angle) * 2;
            gameState.ball.pos.y += Math.sin(gameState.ball.angle) * 2;
            collisionOccurred = true;
            break; // Handle one collision per frame
        }
    }

    // 3. Check Out Of Bounds
    let playerEliminated = false;
    let losingPlayerId = null;

    if (numAlive === 2) {
        // *** 2-Player Out Of Bounds Check ***
        if (gameState.ball.pos.x < MARGIN - BALL_RADIUS) { // Ball passed left side
            // Find player associated with the left side (first player in the pair)
            losingPlayerId = gameState.arena.sides[0]?.player; // Assumes sides[0] is left
            console.log(`Ball out left. Player ${losingPlayerId} missed!`);
        } else if (gameState.ball.pos.x > WIDTH - MARGIN + BALL_RADIUS) { // Ball passed right side
            // Find player associated with the right side (second player in the pair)
            losingPlayerId = gameState.arena.sides[1]?.player; // Assumes sides[1] is right
             console.log(`Ball out right. Player ${losingPlayerId} missed!`);
        }
    } else if (numAlive > 2) {
        // *** N-Player Out Of Bounds Check (Original Logic) ***
        const center = { x: WIDTH / 2, y: HEIGHT / 2 };
        const ballDistFromCenter = Math.hypot(gameState.ball.pos.x - center.x, gameState.ball.pos.y - center.y);
        const currentRadius = RADIUS_BASE;

        if (ballDistFromCenter > currentRadius + BALL_RADIUS + 5) { // Ball is significantly outside polygon
            let minDist = Infinity;
            let losingSide = null;
            for(const side of gameState.arena.sides) {
                // Find the side the ball is closest to *after* going out
                const midSideX = (side.p1.x + side.p2.x) / 2;
                const midSideY = (side.p1.y + side.p2.y) / 2;
                // Check angle from center to ball vs angle from center to side midpoint
                const ballAngleFromCenter = Math.atan2(gameState.ball.pos.y - center.y, gameState.ball.pos.x - center.x);
                const sideAngleFromCenter = Math.atan2(midSideY - center.y, midSideX - center.x);
                // Normalize angles to be positive
                const normalizedBallAngle = (ballAngleFromCenter + 2 * Math.PI) % (2 * Math.PI);
                const normalizedSideAngle = (sideAngleFromCenter + 2 * Math.PI) % (2 * Math.PI);

                // Find the side whose angle range contains the ball's angle
                const anglePerPlayer = (2 * Math.PI) / numAlive;
                const lowerBound = (normalizedSideAngle - anglePerPlayer / 2 + 2 * Math.PI) % (2 * Math.PI);
                const upperBound = (normalizedSideAngle + anglePerPlayer / 2 + 2 * Math.PI) % (2 * Math.PI);

                let angleIsWithin = false;
                if (lowerBound < upperBound) { // Normal case
                    angleIsWithin = normalizedBallAngle >= lowerBound && normalizedBallAngle < upperBound;
                } else { // Wraps around 0/2PI
                    angleIsWithin = normalizedBallAngle >= lowerBound || normalizedBallAngle < upperBound;
                }

                if (angleIsWithin) {
                     losingSide = side;
                     break; // Found the side the ball went past
                }
            }

             if (losingSide) {
                losingPlayerId = losingSide.player;
                console.log(`Ball out polygon side. Player ${losingPlayerId} missed!`);
             } else {
                 console.log("Ball out polygon, but couldn't determine player. Resetting."); // Fallback
             }
        }
    }

    // Handle elimination if occurred
    if (losingPlayerId && gameState.players[losingPlayerId]) {
        gameState.players[losingPlayerId].alive = false;
        playerEliminated = true;
        gameState.winner = null; // Reset winner check
        resetBall(); // Reset ball position and angle
        updateArena(); // Recalculate arena for remaining players

        // Check for winner immediately after updating arena
        const alivePlayersNow = Object.values(gameState.players).filter(p => p.alive);
        if (alivePlayersNow.length === 1 && Object.keys(gameState.players).length > 1) {
            handleWin(alivePlayersNow[0]);
        } else if (alivePlayersNow.length === 0 && Object.keys(gameState.players).length > 0) {
            handleDraw();
        }
    } else if (losingPlayerId) {
         console.log("Ball out, but losing player ID not found in gameState. Resetting ball.");
         resetBall(); // Reset ball even if player ID was bad
    }


    // 4. Broadcast State (only if game didn't end this frame)
    if (gameState.gameActive) { // Check if game is still active after potential win/draw
         broadcastGameState();
    }
}

function broadcastGameState() {
    const stateToSend = {
        type: 'update',
        gameState: {
            players: Object.values(gameState.players).map(p => ({ // Don't send ws object
                id: p.id,
                color: p.color,
                offset: p.offset,
                alive: p.alive,
            })),
            ball: gameState.ball,
            arena: gameState.arena, // Send verts and paddles
            winner: gameState.winner,
            gameActive: gameState.gameActive,
            waitingForPlayers: gameState.waitingForPlayers, // Include waiting state
            startTime: gameState.startTime, // Include start time for countdown display
        }
    };
    const message = JSON.stringify(stateToSend);
    // console.log("Broadcasting:", message); // Debug
    clients.forEach((playerData, ws) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    if (clients.size >= MAX_PLAYERS) {
        console.log("Max players reached. Connection rejected.");
        ws.close(1008, "Server full");
        return;
    }

    const playerId = uuidv4();
    const playerColor = COLORS[clients.size % COLORS.length];
    console.log(`Client connected: ${playerId} (${playerColor})`);

    const playerData = {
        id: playerId,
        color: playerColor,
        offset: 0,
        alive: true,
        ws: ws, // Keep reference for direct communication if needed
    };
    clients.set(ws, playerData); // Map ws to data
    gameState.players[playerId] = playerData; // Add to game state by ID

    // Send initial state to the new player
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        initialState: { // Send relevant parts of initial state
             players: Object.values(gameState.players).map(p => ({ id: p.id, color: p.color, offset: p.offset, alive: p.alive })),
             ball: gameState.ball,
             arena: gameState.arena,
             winner: gameState.winner,
             gameActive: gameState.gameActive,
             waitingForPlayers: gameState.waitingForPlayers, // Send current wait status
             startTime: gameState.startTime, // Send start time if waiting
        }
    }));

    updateArena(); // Update arena geometry and potentially start countdown
    broadcastGameState(); // Inform everyone about the new player and arena/wait status

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = clients.get(ws);
            // Allow input even if player is dead? Maybe not. Allow if player exists.
            if (!player) return; // Ignore input if player not found

            if (data.type === 'input' && player.alive) { // Only allow input if alive
                if (data.action === 'left') {
                    player.offset -= PADDLE_SPEED;
                } else if (data.action === 'right') {
                    player.offset += PADDLE_SPEED;
                }
                 // Update arena immediately to reflect paddle position change.
                 // updateArena will now correctly calculate geometry based on n
                 // and clamp the offset based on the current geometry.
                 updateArena();
                 // Broadcast state immediately if the game loop isn't running
                 // or if we are in the waiting phase, so players see paddle move.
                 if (!gameState.gameActive || gameState.waitingForPlayers) {
                    broadcastGameState();
                 }
            }
        } catch (error) {
            console.error('Failed to parse message or invalid message format:', message.toString(), error);
        }
    });

    ws.on('close', () => {
        const player = clients.get(ws);
        if (player) {
            console.log(`Client disconnected: ${player.id}`);
            // const wasWaiting = gameState.waitingForPlayers; // Less critical now with new structure
            delete gameState.players[player.id];
            clients.delete(ws);
            updateArena(); // Update arena for remaining players, handles state changes (cancels countdown etc.)
            // Broadcast needed if the game isn't actively running and broadcasting via gameLoop
            if (!gameState.gameActive) {
                 broadcastGameState();
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        const player = clients.get(ws);
        if (player) {
            console.log(`Cleaning up player due to error: ${player.id}`);
            // const wasWaiting = gameState.waitingForPlayers; // Less critical now
            delete gameState.players[player.id];
            clients.delete(ws);
            updateArena();
            if (!gameState.gameActive) {
                 broadcastGameState();
            }
        }
    });
});

// Start the game loop
setInterval(gameLoop, 1000 / FPS);

// --- Add helper functions for win/draw if they don't exist ---
function handleWin(winnerPlayer) {
    console.log(`Player ${winnerPlayer.id} wins!`);
    gameState.winner = winnerPlayer.id;
    gameState.gameActive = false;
    // Reset all remaining players to alive for the next round setup
    Object.values(gameState.players).forEach(p => p.alive = true);
    // Don't reset offset here, keep last position? Or reset? Let's reset.
    Object.values(gameState.players).forEach(p => p.offset = 0);
    updateArena(); // Update arena to potentially start countdown for next game
    broadcastGameState(); // Broadcast the win state and updated arena/wait status
}

function handleDraw() {
    console.log("Game is a draw!");
    gameState.winner = 'draw'; // Indicate a draw state
    gameState.gameActive = false;
    Object.values(gameState.players).forEach(p => p.alive = true);
    Object.values(gameState.players).forEach(p => p.offset = 0);
    updateArena();
    broadcastGameState();
}
