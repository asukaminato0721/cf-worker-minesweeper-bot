const GAME_CONFIG = {
	ROWS: 8,
	COLS: 8,
	MINES: 10,
	MAX_REVEALS: 50
};

const DIRECTIONS = [
	[-1, -1], [-1, 0], [-1, 1],
	[0, -1], [0, 1],
	[1, -1], [1, 0], [1, 1]
];

const EMOJI = {
	HIDDEN: '⬜',
	MINE: '💣',
	FLAG: '🚩',
	NUMBERS: ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'],
	TIMER: '⏱️'
};

function isValidPosition(row: number, col: number) {
	return row >= 0 && row < GAME_CONFIG.ROWS &&
		col >= 0 && col < GAME_CONFIG.COLS;
}

function calculateNumbers(board: number[][]) {
	for (let row = 0; row < GAME_CONFIG.ROWS; row++) {
		for (let col = 0; col < GAME_CONFIG.COLS; col++) {
			if (board[row][col] !== -1) {
				let count = 0;
				for (const [dx, dy] of DIRECTIONS) {
					const newRow = row + dx;
					const newCol = col + dy;
					if (isValidPosition(newRow, newCol) && board[newRow][newCol] === -1) {
						count++;
					}
				}
				board[row][col] = count;
			}
		}
	}
}

type Game = ReturnType<typeof createNewGame>;

function createNewGame() {
	const board = Array(GAME_CONFIG.ROWS).fill(null).map(() =>
		Array(GAME_CONFIG.COLS).fill(0)
	);

	let minesPlaced = 0;
	while (minesPlaced < GAME_CONFIG.MINES) {
		const row = Math.floor(Math.random() * GAME_CONFIG.ROWS);
		const col = Math.floor(Math.random() * GAME_CONFIG.COLS);

		if (board[row][col] !== -1) {
			board[row][col] = -1;
			minesPlaced++;
		}
	}

	calculateNumbers(board);

	return {
		board,
		mask: Array(GAME_CONFIG.ROWS).fill(null).map(() =>
			Array(GAME_CONFIG.COLS).fill(false)
		),
		flags: Array(GAME_CONFIG.ROWS).fill(null).map(() =>
			Array(GAME_CONFIG.COLS).fill(false)
		),
		gameOver: false,
		won: false,
		startTime: Date.now(),
		moves: 0,
		endTime: undefined
	};
}

// 自动标记周围的旗子
function autoFlag(game: Game, row: number, col: number) {
	if (!game.mask[row][col] || game.board[row][col] <= 0) return false;

	let flaggedCount = 0;
	let hiddenCount = 0;
	let hiddenPositions = [];

	// 检查周围格子
	for (const [dx, dy] of DIRECTIONS) {
		const newRow = row + dx;
		const newCol = col + dy;
		if (isValidPosition(newRow, newCol)) {
			if (game.flags[newRow][newCol]) {
				flaggedCount++;
			} else if (!game.mask[newRow][newCol]) {
				hiddenCount++;
				hiddenPositions.push([newRow, newCol]);
			}
		}
	}

	// 如果未标记的格子数量等于剩余地雷数,全部标记为旗子
	if (hiddenCount > 0 && game.board[row][col] - flaggedCount === hiddenCount) {
		for (const [r, c] of hiddenPositions) {
			game.flags[r][c] = true;
		}
		return true;
	}

	return false;
}

function revealEmpty(game: Game, row: number, col: number, maxReveals = GAME_CONFIG.MAX_REVEALS) {
	if (!isValidPosition(row, col) || game.mask[row][col] || game.flags[row][col] || maxReveals <= 0) {
		return maxReveals;
	}

	game.mask[row][col] = true;
	maxReveals--;

	if (game.board[row][col] === 0) {
		for (const [dx, dy] of DIRECTIONS) {
			const newRow = row + dx;
			const newCol = col + dy;
			maxReveals = revealEmpty(game, newRow, newCol, maxReveals);
		}
	}

	return maxReveals;
}

function formatTime(ms: number) {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function getCellDisplay(game: Game, row: number, col: number) {
	if (game.flags[row][col]) {
		return EMOJI.FLAG;
	}
	if (!game.mask[row][col]) {
		return EMOJI.HIDDEN;
	}
	if (game.board[row][col] === -1) {
		return EMOJI.MINE;
	}
	return EMOJI.NUMBERS[game.board[row][col]];
}

function generateKeyboard(game: Game) {
	const keyboard = [];
	for (let row = 0; row < GAME_CONFIG.ROWS; row++) {
		const rowButtons = [];
		for (let col = 0; col < GAME_CONFIG.COLS; col++) {
			const display = getCellDisplay(game, row, col);
			rowButtons.push({
				text: display,
				callback_data: `c_${row}_${col}`
			});
		}
		keyboard.push(rowButtons);
	}
	return keyboard;
}

function generateGameBoard(game: Game) {
	const timeSpent = game.gameOver ?
		(game.endTime! - game.startTime) :
		(Date.now() - game.startTime);

	return `${EMOJI.TIMER} ${formatTime(timeSpent)} | 移动: ${game.moves}\n剩余地雷: ${GAME_CONFIG.MINES - game.flags.flat().filter(f => f).length}`;
}

async function handleRequest(request: Request, env: Env) {
	if (request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	const update = await request.json();
	const chatId = update.callback_query?.message?.chat?.id || update.message?.chat?.id;

	if (!chatId) {
		return new Response('OK');
	}

	let game;
	let messageText;
	let keyboard;

	if (update.message?.text === '/start' || update.message?.text === '/newgame') {
		game = createNewGame();
		messageText = generateGameBoard(game);
		keyboard = generateKeyboard(game);

		await env.MinesweeperStore.put(`game:${chatId}`, JSON.stringify(game));

		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: messageText,
				reply_markup: { inline_keyboard: keyboard }
			})
		});

		return new Response('OK');
	}

	if (update.callback_query?.data?.startsWith('c_')) {
		const messageId = update.callback_query.message.message_id;
		const [, row, col] = update.callback_query.data.split('_').map(Number);

		const gameStr = await env.MinesweeperStore.get(`game:${chatId}`);
		if (!gameStr) {
			return new Response('OK');
		}

		game = JSON.parse(gameStr);

		if (game.gameOver) {
			return new Response('OK');
		}

		// 如果点击已显示的数字,检查周围旗子并可能展开
		if (game.mask[row][col] && game.board[row][col] > 0) {
			// 计算周围的旗子数量
			let flagCount = 0;
			let unopenedCells = [];

			for (const [dx, dy] of DIRECTIONS) {
				const newRow = row + dx;
				const newCol = col + dy;
				if (isValidPosition(newRow, newCol)) {
					if (game.flags[newRow][newCol]) {
						flagCount++;
					} else if (!game.mask[newRow][newCol]) {
						unopenedCells.push([newRow, newCol]);
					}
				}
			}

			// 如果旗子数量等于数字，自动展开其他格子
			if (flagCount === game.board[row][col]) {
				let hitMine = false;
				for (const [r, c] of unopenedCells) {
					if (game.board[r][c] === -1) {
						hitMine = true;
						break;
					}
				}

				if (hitMine) {
					// 踩雷了，游戏结束
					game.gameOver = true;
					game.endTime = Date.now();
					// 显示所有地雷
					for (let r = 0; r < GAME_CONFIG.ROWS; r++) {
						for (let c = 0; c < GAME_CONFIG.COLS; c++) {
							if (game.board[r][c] === -1) {
								game.mask[r][c] = true;
							}
						}
					}
				} else {
					// 安全展开所有未标记格子
					for (const [r, c] of unopenedCells) {
						revealEmpty(game, r, c);
					}
					if (unopenedCells.length > 0) {
						game.moves++;
					}
				}
			} else if (autoFlag(game, row, col)) {
				// 如果不能展开，尝试自动标记
				game.moves++;
			}
		} else if (!game.flags[row][col]) {
			game.moves++;

			if (game.board[row][col] === -1) {
				game.gameOver = true;
				game.endTime = Date.now();
				// 显示所有地雷
				for (let r = 0; r < GAME_CONFIG.ROWS; r++) {
					for (let c = 0; c < GAME_CONFIG.COLS; c++) {
						if (game.board[r][c] === -1) {
							game.mask[r][c] = true;
						}
					}
				}
			} else {
				revealEmpty(game, row, col);
			}
		}

		// 检查是否获胜
		if (!game.gameOver) {
			let correctFlags = 0;
			let totalFlags = 0;
			for (let r = 0; r < GAME_CONFIG.ROWS; r++) {
				for (let c = 0; c < GAME_CONFIG.COLS; c++) {
					if (game.flags[r][c]) {
						totalFlags++;
						if (game.board[r][c] === -1) {
							correctFlags++;
						}
					}
				}
			}

			if (correctFlags === GAME_CONFIG.MINES && totalFlags === GAME_CONFIG.MINES) {
				game.gameOver = true;
				game.won = true;
				game.endTime = Date.now();
			}
		}

		await env.MinesweeperStore.put(`game:${chatId}`, JSON.stringify(game));

		messageText = generateGameBoard(game);
		if (game.gameOver) {
			messageText += game.won ? '\n你赢了! 🎉' : '\n游戏结束! 💥';
			await env.MinesweeperStore.delete(`game:${chatId}`);
		}

		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				message_id: messageId,
				text: messageText,
				reply_markup: { inline_keyboard: generateKeyboard(game) }
			})
		});
	}

	return new Response('OK');
}

export default {
	async fetch(request, env) {
		try {
			return await handleRequest(request, env);
		} catch (error) {
			console.error('Error:', error);
			return new Response('Error processing request', { status: 500 });
		}
	}
} satisfies ExportedHandler<Env>;
