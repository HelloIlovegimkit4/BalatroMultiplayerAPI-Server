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

const PORT = 8788

/** reconnect grace period (ms) */
const RECONNECT_TIMEOUT = 30_000

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

  socket.on('data', (data) => {
    const messages = data.toString().split('\n')

    for (const msg of messages) {
      if (!msg) continue

      try {
        const message: ActionClientToServer | ActionUtility = JSON.parse(msg)
        const { action, ...args } = message

        console.log(`← ${action}`, args)

        // Reconnect handling
        if (action === 'reconnect') {
          const { playerId } = args as ActionReconnect
          const existing = clientsByPlayerId.get(playerId)

          if (!existing) {
            // First connection
            client.playerId = playerId
            clientsByPlayerId.set(playerId, client)
            client.markAsNewConnection()
            console.log(`New player registered ${playerId}`)
            return
          }

          // Reattach socket to existing client
          existing.sendAction = client.sendAction
          existing.closeConnection = client.closeConnection
          existing.lastDisconnectedAt = undefined
          existing.handleReconnectAttempt(playerId)
		  existing.lobby?.resyncClient(existing);

          // kill temp client
          client.closeConnection()
          client = existing

          return
        }

        // Normal action routing
        const handler = (actionHandlers as any)[action]
        if (handler) {
          handler(args, client)
        }

      } catch (err) {
        console.error('Parse error', err)
        client.sendAction({ action: 'error', message: 'Invalid message' })
      }
    }
  })

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on ${PORT}`)
})

