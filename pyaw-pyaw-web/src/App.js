import mqtt from 'mqtt';
import { useEffect, useMemo, useRef, useState } from 'react';
import MapComponent from './components/MapComponent/MapComponent';
import MenuButton from './components/MenuButton/MenuButton';

const DEFAULT_SESSION_MS = 5 * 60 * 1000;
const DEFAULT_API_BASE_URL = 'https://pyaw-pyaw-api.onrender.com';
const CLIENT_ID_KEY = 'pyaw-pyaw-client-id';
const MIN_SCAN_VISIBILITY_MS = 15 * 1000;

function normalizeBaseUrl(urlText) {
  return (urlText || '').trim().replace(/\/+$/, '');
}

function resolveApiBaseUrl() {
  const configured = normalizeBaseUrl(process.env.REACT_APP_API_BASE_URL);
  if (configured) {
    return configured;
  }
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:4000';
  }
  return DEFAULT_API_BASE_URL;
}

const apiBaseUrl = resolveApiBaseUrl();

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const payload = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed: ${response.status}`);
  }

  return payload;
}

function parseExpiresAt(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Date.now() + DEFAULT_SESSION_MS;
}

function getOrCreateClientId() {
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const nextId = `web-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(CLIENT_ID_KEY, nextId);
  return nextId;
}

function buildHostIdPayload(hostId, roomData) {
  if (!hostId) {
    return hostId;
  }
  const metadata = {
    lat: roomData?.lat,
    lng: roomData?.lng,
    gender: roomData?.gender === 'Female' ? 'Female' : 'Male',
  };
  if (!Number.isFinite(metadata.lat) || !Number.isFinite(metadata.lng)) {
    return hostId;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  const encoded = window.btoa(String.fromCharCode(...bytes));
  return `${hostId}::meta::${encoded}`;
}

function readHostIdPayload(hostId) {
  if (typeof hostId !== 'string') {
    return null;
  }
  const [, encoded] = hostId.split('::meta::');
  if (!encoded) {
    return null;
  }
  try {
    const binary = window.atob(encoded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(decoded);
    if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lng)) {
      return null;
    }
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      gender: parsed.gender === 'Female' ? 'Female' : 'Male',
    };
  } catch (error) {
    return null;
  }
}

function RoomTab({ topic, role, sessionExpiresAt }) {
  const [isPeerJoined, setIsPeerJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [transportError, setTransportError] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000))
  );
  const mqttClientRef = useRef(null);
  const clientIdRef = useRef(getOrCreateClientId());
  const hasSeenPeerRef = useRef(false);
  const isExpired = remainingSeconds <= 0;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

  useEffect(() => {
    let isUnmounted = false;
    let mqttClient;

    const setupMqtt = async () => {
      try {
        setTransportError('');
        setIsConnecting(true);
        hasSeenPeerRef.current = false;
        const mqttConfig = await requestJson('/api/mqtt/config');
        if (isUnmounted) {
          return;
        }

        const wsUrl = `${mqttConfig.protocol}://${mqttConfig.host}${mqttConfig.path}`;
        const roomChannels = [`${topic}/presence`, `${topic}/chat`];

        mqttClient = mqtt.connect(wsUrl, {
          clientId: clientIdRef.current,
          reconnectPeriod: 2000,
          connectTimeout: 10000,
          clean: true,
        });

        mqttClientRef.current = mqttClient;

        mqttClient.on('connect', () => {
          if (isUnmounted) {
            return;
          }
          setTransportError('');
          setIsConnecting(false);
          mqttClient.subscribe(roomChannels, subscribeError => {
            if (subscribeError) {
              setTransportError(subscribeError.message || 'Failed to subscribe room channels.');
              return;
            }
            mqttClient.publish(
              `${topic}/presence`,
              JSON.stringify({
                type: 'join',
                clientId: clientIdRef.current,
                senderId: clientIdRef.current,
                senderRole: role,
              })
            );
          });
        });

        mqttClient.on('reconnect', () => {
          if (!isUnmounted) {
            setIsConnecting(true);
          }
        });

        mqttClient.on('message', (messageTopic, messageBuffer) => {
          if (Date.now() >= sessionExpiresAt) {
            return;
          }

          const payloadText = messageBuffer.toString('utf8');
          let payload;
          try {
            payload = JSON.parse(payloadText);
          } catch (error) {
            payload = { text: payloadText };
          }

          const senderId = payload?.senderId || payload?.clientId;
          if (senderId && senderId === clientIdRef.current) {
            return;
          }

          if (messageTopic.endsWith('/presence')) {
            setIsPeerJoined(true);
            if (!hasSeenPeerRef.current && mqttClient.connected) {
              hasSeenPeerRef.current = true;
              mqttClient.publish(
                `${topic}/presence`,
                JSON.stringify({
                  type: 'join',
                  clientId: clientIdRef.current,
                  senderId: clientIdRef.current,
                  senderRole: role,
                })
              );
            }
            return;
          }

          if (messageTopic.endsWith('/chat')) {
            const text = typeof payload?.text === 'string' ? payload.text : payloadText;
            setIsPeerJoined(true);
            setMessages(prevMessages => [
              ...prevMessages,
              { sender: payload?.senderRole === 'host' ? 'Host' : 'Guest', text },
            ]);
          }
        });

        mqttClient.on('error', error => {
          if (!isUnmounted) {
            setTransportError(error.message || 'MQTT connection failed.');
          }
        });
      } catch (error) {
        if (!isUnmounted) {
          setTransportError(error.message || 'Unable to initialize realtime connection.');
          setIsConnecting(false);
        }
      }
    };

    setupMqtt();
    return () => {
      isUnmounted = true;
      if (mqttClient) {
        mqttClient.end(true);
      }
      mqttClientRef.current = null;
    };
  }, [topic, role, sessionExpiresAt]);

  const handleSendMessage = () => {
    const messageText = inputValue.trim();
    if (!messageText || !mqttClientRef.current?.connected || isExpired) {
      return;
    }

    const payload = JSON.stringify({
      type: 'chat',
      senderId: clientIdRef.current,
      senderRole: role,
      text: messageText,
    });

    mqttClientRef.current.publish(`${topic}/chat`, payload);
    setMessages(prevMessages => [...prevMessages, { sender: role === 'host' ? 'Host' : 'Guest', text: messageText }]);
    setInputValue('');
  };

  const isWaiting = !isPeerJoined && !isExpired;
  const timerMinutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const timerSeconds = String(remainingSeconds % 60).padStart(2, '0');

  return (
    <div className="room-tab-page">
      <div className="room-panel">
        <div className={`room-timer ${isExpired ? 'expired' : ''}`}>Session Time Left: {timerMinutes}:{timerSeconds}</div>
        {!isWaiting && !isExpired && (
          <>
            <h2 className="room-title">Room Topic</h2>
            <div className="room-topic">{topic}</div>
          </>
        )}
        {isExpired && <div className="room-status expired">Session expired. Please create a new room.</div>}
        {isWaiting && (
          <div className="room-waiting">
            <div className="room-waiting-icon">
              <span />
              <span />
              <span />
            </div>
            <div className="room-status">
              {isConnecting
                ? 'Connecting to realtime server...'
                : role === 'host'
                  ? 'Waiting for someone to join this room...'
                  : 'Connecting to host...'}
            </div>
          </div>
        )}
        {!isWaiting && !isExpired && (
          <div className="chat-box">
            <div className="chat-messages">
              {messages.length === 0 && <div className="chat-empty">Connected. Start sending messages.</div>}
              {messages.map((message, index) => (
                <div key={`${message.sender}-${index}`} className="chat-message-item">
                  <span className="chat-sender">{message.sender}:</span> {message.text}
                </div>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
              />
              <button type="button" className="chat-send-button" onClick={handleSendMessage}>
                Send
              </button>
            </div>
          </div>
        )}
        {transportError && <div className="room-error">{transportError}</div>}
      </div>
    </div>
  );
}

function App() {
  const [createdRoom, setCreatedRoom] = useState(null);
  const [locatedPosition, setLocatedPosition] = useState(null);
  const [searchedRooms, setSearchedRooms] = useState([]);
  const [isSearchingRooms, setIsSearchingRooms] = useState(false);
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const roomTopicFromUrl = searchParams.get('roomTopic');
  const roomRole = searchParams.get('role') === 'host' ? 'host' : 'guest';
  const sessionExpiresAtParam = Number(searchParams.get('sessionExpiresAt'));
  const sessionExpiresAt = Number.isFinite(sessionExpiresAtParam) && sessionExpiresAtParam > 0
    ? sessionExpiresAtParam
    : Date.now() + DEFAULT_SESSION_MS;

  const handleCreateRoom = async roomData => {
    try {
      const hostId = getOrCreateClientId();
      const response = await requestJson('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          message: roomData.message || '',
          hostId: buildHostIdPayload(hostId, roomData),
        }),
      });
      const room = response?.room;
      if (!room?.topic) {
        throw new Error('Room creation failed.');
      }
      const expiresAt = parseExpiresAt(room.expiresAt);
      setCreatedRoom({ ...roomData, topic: room.topic, sessionExpiresAt: expiresAt });
      const roomUrl = `${window.location.origin}${window.location.pathname}?roomTopic=${encodeURIComponent(
        room.topic
      )}&role=host&sessionExpiresAt=${expiresAt}`;
      window.open(roomUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      window.alert(error.message || 'Unable to create room.');
    }
  };

  const handleSearchRooms = async () => {
    const startedAt = Date.now();
    setIsSearchingRooms(true);
    try {
      const response = await requestJson('/api/rooms/active');
      const mappedRooms = (response?.rooms || [])
        .map(room => {
          const metadata = readHostIdPayload(room.hostId);
          return {
            topic: room.topic,
            message: room.message || '',
            sessionExpiresAt: parseExpiresAt(room.expiresAt),
            lat: metadata?.lat,
            lng: metadata?.lng,
            gender: metadata?.gender || 'Male',
          };
        });
      setSearchedRooms(mappedRooms.filter(room => Number.isFinite(room.lat) && Number.isFinite(room.lng)));
      return mappedRooms;
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SCAN_VISIBILITY_MS) {
        await new Promise(resolve => window.setTimeout(resolve, MIN_SCAN_VISIBILITY_MS - elapsed));
      }
      setIsSearchingRooms(false);
    }
  };

  const handleJoinRoom = async room => {
    if (!room?.topic || !room?.sessionExpiresAt) {
      return false;
    }
    try {
      const response = await requestJson('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({
          topic: room.topic,
          guestId: getOrCreateClientId(),
        }),
      });
      const joinedRoom = response?.room;
      const expiresAt = parseExpiresAt(joinedRoom?.expiresAt || room.sessionExpiresAt);
      const roomUrl = `${window.location.origin}${window.location.pathname}?roomTopic=${encodeURIComponent(
        room.topic
      )}&role=guest&sessionExpiresAt=${expiresAt}`;
      window.open(roomUrl, '_blank', 'noopener,noreferrer');
      return true;
    } catch (error) {
      window.alert(error.message || 'Unable to join room.');
      return false;
    }
  };

  const handleLocate = position => {
    if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) {
      return;
    }
    setLocatedPosition(position);
  };

  if (roomTopicFromUrl) {
    return <RoomTab topic={roomTopicFromUrl} role={roomRole} sessionExpiresAt={sessionExpiresAt} />;
  }

  return (
    <div className="App">
      <MapComponent
        createdRoom={createdRoom}
        locatedPosition={locatedPosition}
        searchedRooms={searchedRooms}
        isSearchingRooms={isSearchingRooms}
      />
      <MenuButton
        onCreateRoom={handleCreateRoom}
        onSearchRooms={handleSearchRooms}
        onJoinRoom={handleJoinRoom}
        onLocate={handleLocate}
      />
    </div>
  );
}

export default App;
