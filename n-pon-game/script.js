// Assuming input_handler.js is loaded first and setupInputHandler is global

const server_ip = '192.168.224.103'; // Or your server IP '79.72.48.120'
const port = '8081'; // N-Pon server port

const canvas = document.getElementById("gameCanvas");
const context = canvas.getContext("2d");

const BALL_RADIUS = 10; // Match server
const PADDLE_WIDTH = 10; // Match server

// Client State
let ws;
let myPlayerId = null;
let currentGameState = {
    players: [],
    ball: { pos: { x: -100, y: -100 }, angle: 0 }, // Initial off-screen
    arena: { verts: [], paddles: [] },
    winner: null,
    gameActive: false,
};

function drawGame() {
    // Clear canvas
    context.fillStyle = '#000'; // Black background
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Draw arena outline
    if (currentGameState.arena.verts.length > 1) {
        context.strokeStyle = '#FFF'; // White outline
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(currentGameState.arena.verts[0].x, currentGameState.arena.verts[0].y);
        for (let i = 1; i < currentGameState.arena.verts.length; i++) {
            context.lineTo(currentGameState.arena.verts[i].x, currentGameState.arena.verts[i].y);
        }
        context.closePath();
        context.stroke();
    }

    // Draw paddles
    currentGameState.arena.paddles.forEach(paddle => {
        const player = currentGameState.players.find(p => p.id === paddle.player);
        if (player && player.alive) { // Only draw paddles for alive players
             context.strokeStyle = paddle.color;
             context.lineWidth = PADDLE_WIDTH;
             context.beginPath();
             context.moveTo(paddle.p1.x, paddle.p1.y);
             context.lineTo(paddle.p2.x, paddle.p2.y);
             context.stroke();
        }
    });

    // Draw ball
    if (currentGameState.gameActive || currentGameState.players.length > 0) { // Draw ball if game is active or players exist
        context.fillStyle = '#FFF'; // White ball
        context.beginPath();
        context.arc(currentGameState.ball.pos.x, currentGameState.ball.pos.y, BALL_RADIUS, 0, Math.PI * 2);
        context.fill();
    }

     // Display Winner Message
     if (currentGameState.winner) {
        context.fillStyle = '#FFF';
        context.font = '48px sans-serif';
        context.textAlign = 'center';
        const winnerPlayer = currentGameState.players.find(p => p.id === currentGameState.winner);
        const winnerColor = winnerPlayer ? winnerPlayer.color : '#FFF'; // Use player color if found
        context.fillStyle = winnerColor;
        context.fillText(`Player ${winnerColor} Wins!`, canvas.width / 2, canvas.height / 2);
        context.textAlign = 'left'; // Reset alignment
    } else if (!currentGameState.gameActive && currentGameState.players.length > 0) {
         context.fillStyle = '#AAA';
         context.font = '30px sans-serif';
         context.textAlign = 'center';
         context.fillText(`Waiting for players... (${currentGameState.players.length}/2 minimum)`, canvas.width / 2, canvas.height / 2);
         context.textAlign = 'left'; // Reset alignment
    }
}


function connectToServer() {
    ws = new WebSocket(`ws://${server_ip}:${port}`);

    ws.onopen = () => {
        console.log('Connected to N-Pon server');
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // console.log('Message from server:', message); // Debug

            if (message.type === 'init') {
                myPlayerId = message.playerId;
                currentGameState = message.initialState; // Overwrite client state
                console.log(`Initialized with Player ID: ${myPlayerId}`);
            } else if (message.type === 'update') {
                 // Only update if the game hasn't ended locally by a 'win' message
                 if (ws.readyState === WebSocket.OPEN) {
                    currentGameState = message.gameState;
                 }
            } else if (message.type === 'win') {
                // Server confirms win specifically for the winner
                console.log("Received win message. You win!");
                alert("Congratulations! You are the last one standing!");
                // The 'update' message should also contain the winner ID for display
                // ws.close(); // Optionally close connection on win
            }
            // Add handlers for other message types if needed (e.g., 'gameOver' for losers)

            // Re-draw the game with the new state
            drawGame();

        } catch (error) {
            console.error('Failed to parse message or handle incoming data:', event.data, error);
        }
    };

    ws.onclose = (event) => {
        console.log('Disconnected from N-Pon server', event.reason);
        alert(`Disconnected from server: ${event.reason || 'Connection closed'}`);
        myPlayerId = null;
        // Reset state or show disconnected message
        currentGameState = { // Reset state
             players: [],
             ball: { pos: { x: -100, y: -100 }, angle: 0 },
             arena: { verts: [], paddles: [] },
             winner: null,
             gameActive: false,
        };
        drawGame(); // Clear the board
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('WebSocket connection error.');
    };
}

function main() {
    // Setup input handler to send messages via WebSocket
    setupInputHandler((action) => {
        if (ws && ws.readyState === WebSocket.OPEN && currentGameState.gameActive) {
            ws.send(JSON.stringify({ type: 'input', action: action }));
        }
    });

    // Connect to server
    connectToServer();

    // Initial draw (likely empty until connection)
    drawGame();
}

main();
