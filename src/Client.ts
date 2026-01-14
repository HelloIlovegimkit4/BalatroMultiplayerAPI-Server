import { type AddressInfo } from 'node:net'
import { v4 as uuidv4 } from 'uuid'
import type Lobby from './Lobby.js'
import type { ActionServerToClient } from './actions.js'
import { InsaneInt } from './InsaneInt.js'

type SendFn = (action: ActionServerToClient) => void
type CloseConnFn = () => void

/* biome-ignore lint/complexity/noBannedTypes: 
	This is how the net module does it */
type Address = AddressInfo | {}

class Client {
	// Connection info
	id: string
	// Could be useful later on to detect reconnects
	address: Address
	sendAction: SendFn
	closeConnection: CloseConnFn

	// Game info
	username = 'Guest'
	modHash = 'NULL'
	lobby: Lobby | null = null
	isReadyLobby = false
	/** Whether player is ready for next blind */
	isReady = false
	firstReady = false
	lives = 5
	score = new InsaneInt(0, 0, 0)
	handsLeft = 4
	ante = 1
	skips = 0
	furthestBlind = 0

	livesBlocker = false

	location = 'loc_selecting'

	isCached = true

	// NEW - very important for reconnection support
	playerId: string | null = null;     // persistent identifier from client
	reconnectAttempts = 0;              // how many times this session reconnected
	lastDisconnectedAt?: Date;

	constructor(address: Address, send: SendFn, closeConnection: CloseConnFn) {
		this.id = uuidv4();
		this.address = address;
		this.sendAction = send;
		this.closeConnection = closeConnection;
	}


	setLocation = (location: string) => {
		this.location = location
		if (this.lobby) {
			if (this.lobby.host === this) {
				this.lobby.guest?.sendAction({ action: "enemyLocation", location: this.location })
			} else {
				this.lobby.host?.sendAction({ action: "enemyLocation", location: this.location })
			}
		}
	}

	setUsername = (username: string) => {
		this.username = username
		this.lobby?.broadcastLobbyInfo()
	}

	setModHash = (modHash: string) => {
		this.modHash = modHash
		this.lobby?.broadcastLobbyInfo()
	}

	setLobby = (lobby: Lobby | null) => {
		this.lobby = lobby
	}

	resetBlocker = () => {
		this.livesBlocker = false
	}
	// Called when client sends { action: "reconnect", playerId: "xxx" }
	handleReconnectAttempt(incomingPlayerId: string) {
		if (!this.playerId) {
		// First time this connection tells us who they are
		this.playerId = incomingPlayerId;
		this.reconnectAttempts = 0;
		console.log(`New player connected: ${this.username} (${this.playerId})`);
		return;
		}

		if (incomingPlayerId === this.playerId) {
		// Same player → this is a reconnect!
		this.reconnectAttempts++;
		console.log(
			`Player ${this.username} (${this.playerId}) reconnected ` +
			`(attempt #${this.reconnectAttempts})`
		);

		// Optional: you can send back the current game state here
		this.sendCurrentGameState();
		} else {
		// Different player id on same connection? Suspicious...
		console.warn("Player ID mismatch during reconnect attempt");
		}
	}

	// Optional: helper to send current game state after reconnect
	private sendCurrentGameState() {
		if (!this.lobby) return;

		this.sendAction({
			action: 'reconnectSuccess',
			lives: this.lives,
			score: this.score.toString(),   // crucial
		} as unknown as ActionServerToClient);
	}

	// You might also want to update this method:
	loseLife = () => {
		if (!this.livesBlocker) {
		this.lives -= 1;
		this.livesBlocker = true;

		this.sendAction({ action: "playerInfo", lives: this.lives });

		// Also send to enemy...
		}
	};

	// Optional: reset some state when connection is really new
	markAsNewConnection() {
		this.reconnectAttempts = 0;
		// Maybe reset ready status etc. depending on your game rules
	}
}

export default Client
