import { Socket, createServer } from 'node:net'
import Client from './Client.js'
import { actionHandlers } from './actionHandlers.js'
import type {
	Action,
	ActionReconnect,
	ActionClientToServer,
	ActionCreateLobby,
	ActionEatPizza,
	ActionHandlerArgs,
	ActionJoinLobby,
	ActionLobbyOptions,
	ActionMagnet,
	ActionMagnetResponse,
	ActionPlayHand,
	ActionReceiveEndGameJokersRequest,
	ActionReceiveNemesisDeckRequest,
	ActionRemovePhantom,
	ActionSendPhantom,
	ActionServerToClient,
	ActionSetAnte,
	ActionSetLocation,
	ActionSetFurthestBlind,
	ActionSkip,
	ActionSpentLastShop,
	ActionStartAnteTimer,
	ActionPauseAnteTimer,
	ActionSyncClient,
	ActionUsername,
	ActionUtility,
	ActionVersion, ActionReceiveNemesisStatsRequest,
} from './actions.js'

let buffer = '';

const PORT = 8788
const HOST = '0.0.0.0'
/** reconnect grace period (ms) */
const RECONNECT_TIMEOUT = 60_000

/** persistent clients */
const clientsByPlayerId = new Map<string, Client>()

const sendActionToSocket =
  (socket: Socket) => (action: any) => {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(action) + '\n')
    }
  }

const server = createServer((socket) => {
  socket.setNoDelay()
  socket.allowHalfOpen = false

  let client = new Client(
    socket.address(),
    sendActionToSocket(socket),
    () => socket.end(),
  )

  client.sendAction({ action: 'connected' })
  client.sendAction({ action: 'version' })

  socket.on('data', (data: Buffer) => {
    buffer += data.toString('utf8');  // ← important: assume UTF-8 text

    let boundary: number;
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary).trim();  // remove trailing \r if any
      buffer = buffer.slice(boundary + 1);

      if (line.length === 0) continue;  // skip empty lines

      try {
        const message: ActionClientToServer | ActionUtility = JSON.parse(line);
        const { action, ...args } = message;

        console.log(`← ${action}`, args);

        // ── Reconnect logic ────────────────────────────────────────
        if (action === 'reconnect') {
          const { playerId } = args as ActionReconnect;
          const existing = clientsByPlayerId.get(playerId);

          if (!existing) {
            client.playerId = playerId;
            clientsByPlayerId.set(playerId, client);
            client.markAsNewConnection();
            console.log(`New player registered ${playerId}`);
            return;
          }

          // Reattach
          existing.sendAction = client.sendAction;
          existing.closeConnection = client.closeConnection;
          existing.lastDisconnectedAt = undefined;
          existing.handleReconnectAttempt(playerId);
          existing.lobby?.resyncClient(existing);

          // Kill temporary client object
          client.closeConnection();
          client = existing;  // now client === existing

          return;
        }

        // Normal handler
        const handler = (actionHandlers as any)[action];
        if (handler) {
          handler(args, client);
        } else {
          console.warn(`No handler for action: ${action}`);
        }

      } catch (err) {
        console.error('Parse error on line:', line);
        console.error(err);

        // Optional: still try to reply if socket alive
        if (!socket.destroyed && socket.writable) {
          socket.write(JSON.stringify({
            action: 'error',
            message: 'Invalid JSON'
          }) + '\n');
        }
      }
    }
  });
  socket.on('end', () => {
    console.log(`Disconnected ${client.id}`)
    client.lastDisconnectedAt = new Date()

    // delayed cleanup
    setTimeout(() => {
      if (!client.lastDisconnectedAt) return

      console.log(`Cleanup client ${client.id}`)
      actionHandlers.leaveLobby?.(client)

      if (client.playerId) {
        clientsByPlayerId.delete(client.playerId)
      }
    }, RECONNECT_TIMEOUT)
  })

  socket.on('error', (err) => {
    console.warn('Socket error', err.code)
  })
})

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`)
})

