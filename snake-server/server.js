import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

const GRID_WIDTH = 30; // Define the width of the game area
const GRID_HEIGHT = 30; // Define the height of the game area

const wss = new WebSocketServer({ port: 8080 }); // Choose a port (e.g., 8080)

const clients = new Map(); // Store connected clients (ws connection -> player data)
const gameState = { // Simple initial game state
    snakes: {}, // Store snake data keyed by player ID
    fruit: { x: 10, y: 10 } // Example fruit position
};
let gameHasStarted = false; // Flag to track if >= 2 players have joined

console.log('WebSocket server started on port 8080');

wss.on('connection', (ws) => {
    // 1. Handle New Connection
    const playerId = uuidv4(); // Generate a unique ID for the player
    console.log(`Client connected: ${playerId}`);

    // Initialize player state
    const initialSnake = [{ x: 5, y: 5 }]; // Example starting position
    const initialDirection = { x: 1, y: 0 };
    clients.set(ws, {
        id: playerId,
        snake: initialSnake,
        direction: initialDirection,
        inputQueue: [] // Add an input queue
    });
    gameState.snakes[playerId] = initialSnake; // Add snake to game state

    // Send the new player their ID and the initial game state
    ws.send(JSON.stringify({ type: 'init', playerId, initialState: gameState }));

    // Check if the game should start (minimum players reached)
    if (!gameHasStarted && clients.size >= 2) {
        gameHasStarted = true;
        console.log("Game active: Minimum player count reached.");
    }

    // Broadcast state to everyone
    broadcastGameState();

    // 2. Handle Messages from Client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = clients.get(ws);

            if (!player) return; // Ignore messages from unknown clients

            // Example: Handle direction change message
            if (data.type === 'directionChange') {
                const requestedDirection = data.direction;
                const player = clients.get(ws); // Ensure we have the player object again

                if (!player) return;

                // 1. Validate the requested direction format ONLY
                if (typeof requestedDirection?.x !== 'number' ||
                    typeof requestedDirection?.y !== 'number' ||
                    (requestedDirection.x === 0 && requestedDirection.y === 0) || // No movement
                    (Math.abs(requestedDirection.x) + Math.abs(requestedDirection.y) !== 1)) { // Ensure it's a cardinal direction (not diagonal)
                    console.warn(`Player ${player.id} sent invalid direction format:`, requestedDirection);
                    return; // Ignore invalid direction format
                }

                // 2. Add the validated direction to the player's input queue
                // Limit queue size to prevent memory issues if needed, e.g., max 2-3 inputs
                if (player.inputQueue.length < 3) {
                     player.inputQueue.push({ x: requestedDirection.x, y: requestedDirection.y });
                }

                // DO NOT change player.direction here anymore
            }

            // Add handlers for other message types as needed

        } catch (error) {
            console.error('Failed to parse message or invalid message format:', message.toString(), error);
        }
    });

    // 3. Handle Client Disconnection
    ws.on('close', () => {
        const player = clients.get(ws);
        if (player) {
            console.log(`Client disconnected: ${player.id}`);
            delete gameState.snakes[player.id]; // Remove snake from game state
            clients.delete(ws); // Remove client from our map

            // If player count drops below 2 after game started, maybe reset?
            // For simplicity, we'll only reset gameHasStarted on win for now.
            // if (gameHasStarted && clients.size < 2) {
            //     console.log("Game inactive: Player count dropped below minimum.");
            //     gameHasStarted = false; // Or handle differently (e.g., pause)
            // }

            broadcastGameState(); // Inform others the player left
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        // Clean up if the connection errored out
        const player = clients.get(ws);
        if (player) {
            delete gameState.snakes[player.id];
            clients.delete(ws);
            broadcastGameState();
        }
    });
});

// 4. Server-Side Game Loop (Basic Example)
function gameLoop() {
    const playersToUpdate = Array.from(clients.entries()); // Get a snapshot of players for this tick
    const nextHeadPositions = new Map(); // Store calculated next head positions { playerId: {x, y} }

    // --- First Pass: Calculate next head positions and check wall collisions ---
    for (const [ws, player] of playersToUpdate) {
        const snake = gameState.snakes[player.id];
        if (!snake || snake.length === 0) continue;

        // --- Process Input Queue ---
        const directionBeforeTick = { ...player.direction };
        while (player.inputQueue.length > 0) {
            const nextDirection = player.inputQueue.shift();
            if (directionBeforeTick.x * nextDirection.x + directionBeforeTick.y * nextDirection.y === 0) {
                player.direction = nextDirection;
                break;
            }
        }
        player.inputQueue = []; // Clear remaining queue for this tick
        // --- End Input Processing ---

        const head = { ...snake[0] };
        head.x += player.direction.x;
        head.y += player.direction.y;

        // --- Collision Detection: Walls ---
        if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
            console.log(`Player ${player.id} hit a wall.`);
            // ws.send(JSON.stringify({ type: 'gameOver', reason: 'wall_collision' })); // Optional
            ws.close(); // Close connection, 'close' handler cleans up
            continue; // Skip storing head position for this player
        }

        nextHeadPositions.set(player.id, head); // Store calculated next head position
    }

    // --- Second Pass: Check inter-snake collisions and update state ---
    for (const [ws, player] of playersToUpdate) {
        const playerId = player.id;
        const nextHead = nextHeadPositions.get(playerId);

        // Skip if player already disconnected (e.g., wall collision)
        if (!nextHead || !gameState.snakes[playerId]) {
             continue;
        }

        let collisionDetected = false;

        // --- Collision Detection: Other Snakes ---
        for (const [otherWs, otherPlayer] of clients.entries()) {
            if (otherPlayer.id === playerId) continue; // Don't check against self

            const otherSnake = gameState.snakes[otherPlayer.id];
            if (!otherSnake || otherSnake.length === 0) continue; // Skip if other snake is invalid

            // Check collision with other snake's body segments
            for (let i = 0; i < otherSnake.length; i++) { // Check against all segments including head
                const segment = otherSnake[i];
                if (nextHead.x === segment.x && nextHead.y === segment.y) {
                    console.log(`Player ${playerId} collided with player ${otherPlayer.id}`);
                    // ws.send(JSON.stringify({ type: 'gameOver', reason: 'snake_collision' })); // Optional
                    ws.close(); // Close connection for the player who crashed
                    collisionDetected = true;
                    break; // Stop checking this other snake
                }
            }
            if (collisionDetected) break; // Stop checking other snakes if collision found
        }

        if (collisionDetected) continue; // Skip update for this player if they collided

        // --- Collision Detection: Self ---
        const ownSnake = gameState.snakes[playerId];
        // Check collision with own body (excluding the current head, index 0)
        for (let i = 1; i < ownSnake.length; i++) {
            const segment = ownSnake[i];
            if (nextHead.x === segment.x && nextHead.y === segment.y) {
                console.log(`Player ${playerId} collided with self.`);
                // ws.send(JSON.stringify({ type: 'gameOver', reason: 'self_collision' })); // Optional
                ws.close();
                collisionDetected = true;
                break;
            }
        }

        if (collisionDetected) continue; // Skip update if self-collision

        // --- Update Snake Position ---
        ownSnake.unshift(nextHead); // Add new head

        // --- Fruit Eating Check ---
        if (nextHead.x === gameState.fruit.x && nextHead.y === gameState.fruit.y) {
            // Grow snake (don't pop tail)
            // Respawn fruit - TODO: Ensure fruit doesn't spawn on any snake
            let newFruitX, newFruitY, fruitOnSnake;
            do {
                fruitOnSnake = false;
                newFruitX = Math.floor(Math.random() * GRID_WIDTH);
                newFruitY = Math.floor(Math.random() * GRID_HEIGHT);
                // Check against all snakes
                for (const [, p] of clients.entries()) {
                    const s = gameState.snakes[p.id];
                    if (!s) continue;
                    for (const seg of s) {
                        if (seg.x === newFruitX && seg.y === newFruitY) {
                            fruitOnSnake = true;
                            break;
                        }
                    }
                    if (fruitOnSnake) break;
                }
            } while (fruitOnSnake);
            gameState.fruit.x = newFruitX;
            gameState.fruit.y = newFruitY;

        } else {
            ownSnake.pop(); // Remove tail if not eating
        }
    }

    // Broadcast the updated state to all remaining clients
    broadcastGameState();
}

// 5. Broadcast Game State Function
function broadcastGameState() {
    // Check if only one player remains *after* the game has started
    if (gameHasStarted && clients.size === 1) {
        const [ws, winnerData] = clients.entries().next().value; // Get the single remaining client
        if (ws.readyState === ws.OPEN) {
            console.log(`Player ${winnerData.id} wins!`);
            ws.send(JSON.stringify({ type: 'win' }));
            gameHasStarted = false; // Reset the flag as the game round ended
            // Optionally close the connection or stop the game loop here
            // ws.close();
            // clearInterval(gameLoopInterval); // Need to store interval ID if you want to clear it
        }
        return; // Stop broadcasting regular updates if someone won
    }

    // If game hasn't started or more than one player remains, broadcast the normal update
    const message = JSON.stringify({ type: 'update', gameState });
    // console.log("Broadcasting state:", message); // Debugging
    clients.forEach((playerData, ws) => {
        if (ws.readyState === ws.OPEN) { // Check if the connection is still open
            ws.send(message);
        }
    });
}

// Run the game loop every ~150ms
// Store the interval ID if you might need to clear it later (e.g., when a player wins)
const gameLoopInterval = setInterval(gameLoop, 150);