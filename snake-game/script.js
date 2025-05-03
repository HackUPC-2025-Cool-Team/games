import { setupInputHandler } from "./input_handler.js";

// Krishna ip: '79.72.48.120', local ip: '10.192.34.122'
const server_ip = 'localhost';
const port = '8080';

const canvas = document.getElementById("game");
const context = canvas.getContext("2d");

const scale = 20; // tile size
const rows = canvas.height / scale;
const colums = canvas.width / scale;

// Multiplayer Variables
let ws;
let myPlayerId = null;
let currentGameState = { snakes: {}, fruit: { x: -1, y: -1 } };

function drawGame() {
    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw fruit from server state
    if (currentGameState.fruit.x !== -1 && currentGameState.fruit.y !== -1) { // Check if fruit position is valid
        context.fillStyle = "#f00";
        context.fillRect(currentGameState.fruit.x * scale, currentGameState.fruit.y * scale, scale, scale);
    }

    // Draw all snakes from server state
    for (const playerId in currentGameState.snakes) {
        const snakeBody = currentGameState.snakes[playerId];
        // Assign color (simple example: green for self, gray for others)
        context.fillStyle = (playerId === myPlayerId) ? "#0f0" : "#888";
        snakeBody.forEach(segment => {
            context.fillRect(segment.x * scale, segment.y * scale, scale, scale);
        });
    }
}

function connectToServer(player_id) {
    // Use ws:// for local, wss:// for deployed secure servers
    ws = new WebSocket(`ws://${server_ip}:${port}`); // Connect to the server address

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        // send the player id to the server
        if (!player_id) {
            console.error("No player id provided for registration.");
        }
        ws.send(JSON.stringify({ type: 'register', player_id: player_id }));
        console.log(`Attempting to register with Player ID: ${player_id}`); // Fix: Use player_id here

    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // console.log('Message from server:', message); // Debugging

            if (message.type === 'init') {
                myPlayerId = message.playerId;
                currentGameState = message.initialState;
                console.log(`Initialized with Player ID: ${myPlayerId}`);
                // Initial draw based on the first state received
                drawGame();
            } else if (message.type === 'update') {
                // Only update if the game hasn't ended (check if ws is still open)
                if (ws.readyState === WebSocket.OPEN) {
                    currentGameState = message.gameState;
                    // Re-draw the game with the new state
                    drawGame();
                }
            } else if (message.type === 'win') {
                // Handle the win message
                console.log("Received win message. You win!");
                alert("Congratulations! You are the last snake standing!"); // Display the win notification
                // Optionally, update UI elements here instead of just an alert
                // document.getElementById('status-message').innerText = 'You Win!';
                ws.close(); // Close the connection as the game is over for the winner
            } else if (message.type === 'gameOver') { // Optional: Handle game over message from server
                alert(`Game Over! Player ${message.winnerId || 'Someone'} won!`);
                // You might want to disable input or show a restart button
                ws.close();
            }
            // Add handlers for other message types if needed

        } catch (error) {
            console.error('Failed to parse message or handle incoming data:', event.data, error);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from WebSocket server');
        alert('Connection lost to server.');
        // Optionally try to reconnect or disable game UI
        myPlayerId = null;
        currentGameState = { snakes: {}, fruit: { x: -1, y: -1 } }; // Reset state
        drawGame(); // Clear the board
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('WebSocket connection error.');
        // Handle errors, maybe try reconnecting
    };
}

window.connectToServer = connectToServer;

/**
 * Establishes a temporary WebSocket connection solely to send a game setup request.
 * @param {string} groupCode - The code for the game group.
 */
function sendSetupRequest(groupCode) {
    if (!groupCode || typeof groupCode !== 'string' || groupCode.trim() === '') {
        console.error("Invalid group code provided for setup.");
        alert("Please provide a valid group code to set up the game.");
        return;
    }

    // Create a new, temporary WebSocket connection for the setup command
    const setupWs = new WebSocket(`ws://${server_ip}:${port}`);
    let setupComplete = false; // Flag to prevent multiple alerts/closes

    setupWs.onopen = () => {
        console.log('Temporary connection opened for game setup.');
        const message = {
            type: 'setupGameRequest',
            group_code: groupCode
        };
        console.log(`Sending setup request for group: ${groupCode}`);
        setupWs.send(JSON.stringify(message));
    };

    setupWs.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Message from server (setup connection):', message);

            if (message.type === 'setupAcknowledged') {
                console.log(`Server acknowledged setup for group: ${message.group_code}`);
                alert(`Game setup initiated for group ${message.group_code}. Players can now join.`);
                setupComplete = true;
                setupWs.close(); // Close the temporary connection
            } else if (message.type === 'error') {
                console.error(`Server returned an error during setup: ${message.message}`);
                alert(`Failed to set up game: ${message.message}`);
                setupComplete = true;
                setupWs.close(); // Close on error
            }
            // Ignore other message types on this temporary connection
        } catch (error) {
            console.error('Failed to parse message on setup connection:', event.data, error);
             if (!setupComplete) {
                alert('Received an invalid response from the server during setup.');
                setupWs.close();
             }
        }
    };

    setupWs.onerror = (error) => {
        console.error('WebSocket error on setup connection:', error);
         if (!setupComplete) {
            alert('Connection error while trying to set up the game.');
         }
        // The 'onclose' event will likely fire after this anyway
    };

    setupWs.onclose = () => {
        console.log('Temporary setup connection closed.');
        if (!setupComplete) {
            // This might happen if the server closes the connection without sending ack/error
            console.warn('Setup connection closed before completion.');
           // alert('Connection closed before game setup could be confirmed.'); // Optional: can be noisy
        }
    };
}

window.sendSetupRequest = sendSetupRequest;

function joinGame(player_id) {
    // Connect to server and setup input handler to send messages
    connectToServer(player_id);
    // Pass the WebSocket connection to the input handler
    setupInputHandler((direction) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'directionChange', direction: direction }));
        }
    });

    // Initial empty draw before connection established
    drawGame();
}

// Example Usage (e.g., called from a button click for an admin/host):
// const groupCodeInput = document.getElementById('group-code-input');
// const setupButton = document.getElementById('setup-button');
//
// setupButton.addEventListener('click', () => {
//     const code = groupCodeInput.value;
//     sendSetupRequest(code); // Use the new function
// });
