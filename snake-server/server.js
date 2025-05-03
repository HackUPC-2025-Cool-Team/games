import PocketBase from "pocketbase";
import { WebSocketServer } from "ws";

// pocketbase shit
const pb = new PocketBase("http://nc.kjorda.com:8090");
// Removed global result_list and missing_players, manage game state differently

const GRID_WIDTH = 30; // Define the width of the game area
const GRID_HEIGHT = 30; // Define the height of the game area

const wss = new WebSocketServer({ port: 8080 }); // Choose a port (e.g., 8080)

const clients = new Map(); // Store connected clients (ws connection -> player data)
const gameState = {
    snakes: {}, // Store snake data keyed by player ID
    fruit: { x: 10, y: 10 }, // Example fruit position
};
// let gameHasStarted = false; // Replaced by gameStatus
let gameStatus = 'idle'; // 'idle', 'waiting', 'running', 'ended'
let expectedPlayerIds = new Set(); // Store IDs of players expected for the current game
let gameLoopIntervalId = null; // To store the interval ID
let lastWinnerId = null; // Variable to store the last winner

console.log("WebSocket server started on port 8080");

wss.on("connection", (ws) => {
    console.log("Client attempting to connect...");
    ws.isRegistered = false;

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // Handle game setup request (can be done before registration)
            if (data.type === 'setupGameRequest' && data.group_code) {
                if (gameStatus === 'idle' || gameStatus === 'ended') {
                    console.log(`Received setup request for group: ${data.group_code}`);
                    // Call setupGame asynchronously but don't wait here
                    setupGame(data.group_code).catch(err => {
                        console.error("Error during setupGame triggered by request:", err);
                        // Optionally send an error back to the requester
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'error', message: 'Failed to setup game.' }));
                        }
                    });
                    // Send confirmation back to the requester
                     if (ws.readyState === ws.OPEN) {
                         ws.send(JSON.stringify({ type: 'setupAcknowledged', group_code: data.group_code }));
                     }
                } else {
                    console.warn(`Setup request ignored: Game status is ${gameStatus}`);
                     if (ws.readyState === ws.OPEN) {
                         ws.send(JSON.stringify({ type: 'error', message: `Cannot setup game, current status: ${gameStatus}` }));
                     }
                }
                return; // Exit after handling setup request
            }

            // handle registration
            if (!ws.isRegistered) {
                if (data.type === 'register' && data.player_id) {
                    const requested_player_id = data.player_id;

                    // If waiting for a specific game, check if this player is expected
                    if (gameStatus === 'waiting' && !expectedPlayerIds.has(requested_player_id)) {
                        console.warn(`Registration failed: Player ${requested_player_id} is not expected for the current game.`);
                        ws.send(JSON.stringify({ type: 'error', message: 'You are not part of the expected players for this game.' }));
                        ws.close();
                        return;
                    }

                    // check if the player id is already taken
                    let id_taken = false;
                    for (const [client_ws, player_data] of clients.entries()) {
                        if (player_data.id === requested_player_id) {
                            id_taken = true;
                            break;
                        }
                    }

                    if (id_taken) {
                        console.warn(`Registration failed: player id ${requested_player_id} is already taken.`);
                         ws.send(JSON.stringify({ type: 'error', message: 'Player ID already taken.' }));
                        ws.close();
                        return;
                    }

                    // register the player
                    const player_id = requested_player_id;
                    console.log(`Client registered with id: ${player_id}`);
                    ws.isRegistered = true;

                    // --- Assign unique starting positions and directions ---
                    const playerIndex = clients.size; // 0 for first player, 1 for second, etc.
                    let startX, startY, startDirX, startDirY;

                    // Example: Distribute players near corners/edges
                    const padding = 3; // How far from the edge to start
                    if (playerIndex === 0) { // Top-left quadrant
                        startX = padding;
                        startY = padding;
                        startDirX = 1; startDirY = 0; // Move right
                    } else if (playerIndex === 1) { // Bottom-right quadrant
                        startX = GRID_WIDTH - 1 - padding;
                        startY = GRID_HEIGHT - 1 - padding;
                        startDirX = -1; startDirY = 0; // Move left
                    } else if (playerIndex === 2) { // Top-right quadrant
                        startX = GRID_WIDTH - 1 - padding;
                        startY = padding;
                        startDirX = 0; startDirY = 1; // Move down
                    } else if (playerIndex === 3) { // Bottom-left quadrant
                        startX = padding;
                        startY = GRID_HEIGHT - 1 - padding;
                        startDirX = 0; startDirY = -1; // Move up
                    } else { // Default for more players (can be improved)
                        startX = Math.floor(GRID_WIDTH / 2) + (playerIndex % 2 === 0 ? playerIndex : -playerIndex); // Spread near center
                        startY = Math.floor(GRID_HEIGHT / 2);
                        startDirX = (playerIndex % 2 === 0 ? 1 : -1); startDirY = 0;
                    }

                    // Ensure start position is within bounds (just in case)
                    startX = Math.max(0, Math.min(GRID_WIDTH - 1, startX));
                    startY = Math.max(0, Math.min(GRID_HEIGHT - 1, startY));

                    const initial_snake = [{ x: startX, y: startY }];
                    const initial_direction = { x: startDirX, startDirY };
                    // --- End of unique starting position assignment ---


                    clients.set(ws, {
                        id: player_id,
                        snake: initial_snake,
                        direction: initial_direction,
                        inputQueue: [],
                    });
                    gameState.snakes[player_id] = initial_snake; // Use the correct variable name

                    // send the new player their id and the initial state
                    ws.send(JSON.stringify({ type: "init", player_id, initialState: gameState }));

                    // Check if the game should start (all expected players connected)
                    if (gameStatus === 'waiting' && clients.size === expectedPlayerIds.size) {
                        console.log("All expected players connected. Starting game loop.");
                        gameStatus = 'running';
                        // Start the game loop
                        if (gameLoopIntervalId) clearInterval(gameLoopIntervalId); // Clear any previous interval
                        gameLoopIntervalId = setInterval(gameLoop, 150);
                        // Broadcast state immediately to show all players
                        broadcastGameState();
                    } else if (gameStatus === 'running' || gameStatus === 'waiting') {
                        // If game is already running or waiting for others, just update state
                         broadcastGameState();
                    }
                    // If gameStatus is 'idle', we wait for startGame to be called.

                } else {
                    console.warn("Client sent invalid first message. Closing connection.");
                    ws.close();
                }
                return; // Exit after handling registration/first message
            } // End of registration handling

            // --- Start handling messages for registered players ---
            const player = clients.get(ws);
            if (!player) return; // Should not happen if registered, but good check

            // handle direction change message
            if (data.type === "directionChange") {
                const requestedDirection = data.direction;

                // 1. Validate the requested direction format ONLY
                if (
                    typeof requestedDirection?.x !== "number" ||
                    typeof requestedDirection?.y !== "number" ||
                    (requestedDirection.x === 0 && requestedDirection.y === 0) || // No movement
                    Math.abs(requestedDirection.x) + Math.abs(requestedDirection.y) !== 1
                ) {
                    console.warn(
                        `Player ${player.id} sent invalid direction format:`,
                        requestedDirection
                    );
                    return; // Ignore invalid direction format
                }

                // 2. Add the validated direction to the player's input queue
                if (player.inputQueue.length < 3) {
                    player.inputQueue.push({
                        x: requestedDirection.x,
                        y: requestedDirection.y,
                    });
                }
            }
            // Handle other message types for registered players here...

        } catch (error) {
            console.error(
                "Failed to parse message or invalid message format:",
                message.toString(),
                error
            );
        }
    });

    ws.on("close", () => {
        const player = clients.get(ws);
        if (player) {
            console.log(`Client disconnected: ${player.id}`);
            delete gameState.snakes[player.id];
            clients.delete(ws);

            // If the game was running and now only one player is left, they win.
            if (gameStatus === 'running' && clients.size === 1) {
                 broadcastGameState(); // This will trigger the win condition check
            } else if (gameStatus === 'running' || gameStatus === 'waiting') {
                // If game was running or waiting, inform remaining players
                broadcastGameState();
            }
            // If the game was waiting and the disconnected player was expected,
            // the game won't start unless they reconnect (or logic is added to handle this).
        }
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        const player = clients.get(ws);
        if (player) {
            delete gameState.snakes[player.id];
            clients.delete(ws);
             if (gameStatus === 'running' || gameStatus === 'waiting') {
                broadcastGameState(); // Update others
             }
        }
    });
});

// 4. Server-Side Game Loop
function gameLoop() {
    // Only run the loop if the game is actually running
    if (gameStatus !== 'running') {
        console.warn("Game loop called but game is not running. Status:", gameStatus);
        // Consider clearing the interval if this happens unexpectedly
        // if (gameLoopIntervalId) clearInterval(gameLoopIntervalId);
        // gameLoopIntervalId = null;
        return;
    }

    const playersToUpdate = Array.from(clients.entries());
    const nextHeadPositions = new Map();

    // --- First Pass: Calculate next head positions and check wall collisions ---
    for (const [ws, player] of playersToUpdate) {
        const snake = gameState.snakes[player.id];
        if (!snake || snake.length === 0) continue;

        const directionBeforeTick = { ...player.direction };
        while (player.inputQueue.length > 0) {
            const nextDirection = player.inputQueue.shift();
            // Prevent 180-degree turns
            if (
                directionBeforeTick.x * nextDirection.x +
                directionBeforeTick.y * nextDirection.y ===
                0
            ) {
                 // If it's a 180 turn, keep the original direction for this tick
                 // console.log(`Player ${player.id} attempted 180 turn, ignored.`);
            } else {
                 player.direction = nextDirection; // Valid turn, update direction
                 break; // Process only one valid input per tick
            }
        }
        // Input queue is now processed for this tick (either one valid turn used or all invalid ones discarded)

        const head = { ...snake[0] };
        head.x += player.direction.x;
        head.y += player.direction.y;

        // --- Collision Detection: Walls ---
        if (
            head.x < 0 ||
            head.x >= GRID_WIDTH ||
            head.y < 0 ||
            head.y >= GRID_HEIGHT
        ) {
            console.log(`Player ${player.id} hit a wall.`);
            ws.send(JSON.stringify({ type: 'gameOver', reason: 'wall_collision' }));
            ws.close(); // 'close' handler cleans up state
            continue;
        }

        nextHeadPositions.set(player.id, head);
    }

    // --- Second Pass: Check inter-snake collisions and update state ---
    const playersToRemove = new Set(); // Store IDs of players who collided this tick

    for (const [ws, player] of playersToUpdate) {
        const playerId = player.id;
        // Skip if player already disconnected (wall collision) or marked for removal
        if (!clients.has(ws) || playersToRemove.has(playerId)) {
            continue;
        }

        const nextHead = nextHeadPositions.get(playerId);
        if (!nextHead) continue; // Should have been calculated unless wall collision

        let collisionDetected = false;

        // --- Collision Detection: Other Snakes (Heads and Bodies) ---
        for (const [otherWs, otherPlayer] of clients.entries()) {
             // Skip self, disconnected players, or players already marked for removal
            if (otherPlayer.id === playerId || !clients.has(otherWs) || playersToRemove.has(otherPlayer.id)) continue;

            const otherSnake = gameState.snakes[otherPlayer.id];
            if (!otherSnake || otherSnake.length === 0) continue;

            // Check collision with other snake's body segments (including their head)
            for (let i = 0; i < otherSnake.length; i++) {
                const segment = otherSnake[i];
                if (nextHead.x === segment.x && nextHead.y === segment.y) {
                    // Check if it's a head-on collision (both players move to the same square)
                    const otherNextHead = nextHeadPositions.get(otherPlayer.id);
                    if (otherNextHead && i === 0 && nextHead.x === otherNextHead.x && nextHead.y === otherNextHead.y) {
                         console.log(`Head-on collision between ${playerId} and ${otherPlayer.id}`);
                         playersToRemove.add(playerId);
                         playersToRemove.add(otherPlayer.id);
                         // Send gameOver to both
                         if(clients.has(ws)) ws.send(JSON.stringify({ type: 'gameOver', reason: 'head_on_collision' }));
                         if(clients.has(otherWs)) otherWs.send(JSON.stringify({ type: 'gameOver', reason: 'head_on_collision' }));
                    } else {
                        // Normal collision with another snake's body/head
                        console.log(`Player ${playerId} collided with player ${otherPlayer.id}`);
                        playersToRemove.add(playerId);
                         if(clients.has(ws)) ws.send(JSON.stringify({ type: 'gameOver', reason: 'snake_collision' }));
                    }
                    collisionDetected = true;
                    break;
                }
            }
            if (collisionDetected) break;
        }
         if (collisionDetected) continue; // Move to next player if this one collided

        // --- Collision Detection: Self ---
        const ownSnake = gameState.snakes[playerId];
        for (let i = 1; i < ownSnake.length; i++) {
            const segment = ownSnake[i];
            if (nextHead.x === segment.x && nextHead.y === segment.y) {
                console.log(`Player ${playerId} collided with self.`);
                playersToRemove.add(playerId);
                 if(clients.has(ws)) ws.send(JSON.stringify({ type: 'gameOver', reason: 'self_collision' }));
                collisionDetected = true;
                break;
            }
        }
        if (collisionDetected) continue;

        // --- Update Snake Position (if no collision) ---
        ownSnake.unshift(nextHead); // Add new head

        // --- Fruit Eating Check ---
        if (nextHead.x === gameState.fruit.x && nextHead.y === gameState.fruit.y) {
            // Grow snake (don't pop tail)
            // Respawn fruit
            let newFruitX, newFruitY, fruitOnSnake;
            do {
                fruitOnSnake = false;
                newFruitX = Math.floor(Math.random() * GRID_WIDTH);
                newFruitY = Math.floor(Math.random() * GRID_HEIGHT);
                for (const [, p] of clients.entries()) { // Check against current snakes
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

     // --- Third Pass: Remove collided players ---
    if (playersToRemove.size > 0) {
        playersToRemove.forEach(playerIdToRemove => {
            // Find the WebSocket connection associated with the player ID
            for (const [ws, player] of clients.entries()) {
                if (player.id === playerIdToRemove) {
                    if (ws.readyState === ws.OPEN) {
                        ws.close(); // Trigger the 'close' handler for cleanup
                    } else {
                        // If already closing/closed, ensure cleanup happens
                        delete gameState.snakes[playerIdToRemove];
                        clients.delete(ws);
                    }
                    break; // Found the player, move to the next ID in playersToRemove
                }
            }
        });
    }


    // Broadcast the updated state to all remaining clients
    broadcastGameState();
}

// 5. Broadcast Game State Function
function broadcastGameState() {
    // Check win condition: Game was running and now only one client remains
    if (gameStatus === 'running' && clients.size === 1) {
        const [ws, winnerData] = clients.entries().next().value;
        lastWinnerId = winnerData.id; // Store the winner ID
        if (ws.readyState === ws.OPEN) {
            console.log(`Player ${winnerData.id} wins!`);
            ws.send(JSON.stringify({ type: "win" }));
        }
        // Game ended
        console.log("Game ended. Winner:", winnerData.id);
        gameStatus = 'ended';
        if (gameLoopIntervalId) {
            clearInterval(gameLoopIntervalId);
            gameLoopIntervalId = null;
        }
        expectedPlayerIds.clear(); // Reset for a potential new game
        // Optionally close the winner's connection after a delay or keep it open
        // ws.close();
        return; // Stop broadcasting regular updates
    }

     // Check if game was running and no players are left (e.g., simultaneous collision)
    if (gameStatus === 'running' && clients.size === 0) {
        lastWinnerId = null; // No winner
        console.log("Game ended. No players remaining.");
        gameStatus = 'ended';
         if (gameLoopIntervalId) {
            clearInterval(gameLoopIntervalId);
            gameLoopIntervalId = null;
        }
        expectedPlayerIds.clear();
        return;
    }


    // If game is running or waiting, broadcast the normal update
    if (gameStatus === 'running' || gameStatus === 'waiting') {
        const message = JSON.stringify({ type: "update", gameState });
        clients.forEach((playerData, ws) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(message);
            }
        });
    }
}

// Call this function externally (e.g., via an admin command or another trigger)
// to set up the game before players connect.
async function setupGame(group_code) {
    if (gameStatus !== 'idle' && gameStatus !== 'ended') {
        console.warn("Cannot set up a new game while one is in progress or waiting.");
        return;
    }

    console.log(`Setting up game for group code: ${group_code}`);
    // Reset state for a new game
    clients.clear();
    gameState.snakes = {};
    // Reset fruit position maybe?
    gameState.fruit = { x: 10, y: 10 };
    expectedPlayerIds.clear();
    lastWinnerId = null; // Reset last winner ID
    if (gameLoopIntervalId) {
        clearInterval(gameLoopIntervalId);
        gameLoopIntervalId = null;
    }

    try {
        // Read all participants belonging to the same group
        const result_list = await pb.collection('participants').getList(1, 50, { // Assuming max 50 players per group
            filter: `code = "${group_code}"`, // Ensure group_code is treated as a string in the filter
        });

        if (!result_list || !result_list.items || result_list.items.length === 0) {
            console.error(`No participants found for group code: ${group_code}`);
            gameStatus = 'idle'; // Revert status
            return;
        }

        // Store the IDs of the expected players
        result_list.items.forEach(player => {
            // Use the 'id' field from the PocketBase record
            if (player.id) {
                 expectedPlayerIds.add(player.id); // Changed from player.player_id
            } else {
                // Update the warning message if needed, though 'id' should usually exist
                console.warn("Participant record missing id:", player);
            }
        });

        if (expectedPlayerIds.size === 0) {
             console.error(`No valid player IDs found for participants in group: ${group_code}`); // Updated error message slightly
             gameStatus = 'idle';
             return;
        }

        console.log("Expected players:", Array.from(expectedPlayerIds));
        console.log(`Game waiting for ${expectedPlayerIds.size} players to connect...`);
        gameStatus = 'waiting'; // Set status to waiting for players

        // DO NOT start the game loop here. It starts when all players connect.

    } catch (error) {
        console.error("Error fetching participants:", error);
        gameStatus = 'idle'; // Revert status on error
    }
}
