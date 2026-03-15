import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MessageSquare, Key, RefreshCw, Send, LogOut, Trash2, Clock, Users, User } from 'lucide-react';
import { encryptData, decryptData, generateSecureKey, base64ToBytes, bytesToBase64 } from '../lib/crypto';
import { cn } from '../lib/utils';
import { io, Socket } from 'socket.io-client';

interface ChatMessage {
  id: string;
  sender: string;
  senderId: string;
  timestamp: number;
  ciphertext: string;
  iv: string;
  salt: string;
  expiresAt: number;
}

interface DecryptedMessage extends ChatMessage {
  text: string;
  isSelf: boolean;
}

interface Participant {
  id: string;
  name: string;
}

const EXPIRY_OPTIONS = [
  { label: '10 sec', value: 10 },
  { label: '30 sec', value: 30 },
  { label: '1 min', value: 60 },
  { label: '3 min', value: 180 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
];

export default function SecretChatPage({ onBack }: { onBack: () => void }) {
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [expiryTime, setExpiryTime] = useState(60); // Default 1 min
  const [inRoom, setInRoom] = useState(false);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [localUserId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-delete messages locally
  useEffect(() => {
    if (!inRoom) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => prev.filter(m => m.expiresAt > now));
    }, 1000);
    return () => clearInterval(interval);
  }, [inRoom]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const handleGenerateRoom = () => {
    setRoomCode(generateSecureKey().substring(0, 16));
  };

  const decryptIncomingMessage = async (msg: ChatMessage): Promise<DecryptedMessage> => {
    try {
      const payload = {
        version: 1,
        salt: msg.salt,
        iv: msg.iv,
        ciphertext: msg.ciphertext,
        dataType: 'text'
      };
      const jsonStr = JSON.stringify(payload);
      const jsonBytes = new TextEncoder().encode(jsonStr);
      const encryptedString = bytesToBase64(jsonBytes);
      
      const decrypted = await decryptData(encryptedString, roomCode);
      const text = new TextDecoder().decode(decrypted.data);
      
      return {
        ...msg,
        text,
        isSelf: msg.senderId === localUserId
      };
    } catch (err) {
      console.error('Failed to decrypt message', err);
      return {
        ...msg,
        text: '[Encrypted message - wrong room code or corrupted]',
        isSelf: msg.senderId === localUserId
      };
    }
  };

  const handleJoinRoom = async () => {
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }
    if (roomCode.length < 8) {
      setError('Room code must be at least 8 characters long');
      return;
    }
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }

    setError('');
    setConnectionStatus('connecting');

    // Initialize Socket.io
    const socket = io(window.location.origin, {
      reconnectionAttempts: 5,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to socket server');
      setConnectionStatus('connected');
      setInRoom(true);
      setMessages([]);
      // Small delay to ensure server is ready
      setTimeout(() => {
        if (socketRef.current?.connected) {
          socketRef.current.emit('join-room', { roomId: roomCode, name: userName });
        }
      }, 100);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setError(`Connection error: ${err.message}. Please try again.`);
      setConnectionStatus('disconnected');
      setInRoom(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    });

    socket.on('room-state', async (state: { participants: Participant[], messages: ChatMessage[] }) => {
      setParticipants(state.participants);
      
      const decryptedMessages = await Promise.all(
        state.messages.map(m => decryptIncomingMessage(m))
      );
      setMessages(decryptedMessages.sort((a, b) => a.timestamp - b.timestamp));
    });

    socket.on('user-joined', (user: Participant) => {
      setParticipants(prev => [...prev.filter(p => p.id !== user.id), user]);
    });

    socket.on('user-left', (user: Participant) => {
      setParticipants(prev => prev.filter(p => p.id !== user.id));
    });

    socket.on('receive-message', async (msg: ChatMessage) => {
      const decrypted = await decryptIncomingMessage(msg);
      setMessages(prev => {
        const updated = [...prev, decrypted];
        return updated.sort((a, b) => a.timestamp - b.timestamp);
      });
    });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !socketRef.current) return;

    setIsSending(true);
    const messageText = newMessage;
    setNewMessage('');

    try {
      const dataToEncrypt = new TextEncoder().encode(messageText);
      const encryptedString = await encryptData(dataToEncrypt, roomCode, 'text');
      
      const jsonBytes = base64ToBytes(encryptedString);
      const jsonStr = new TextDecoder().decode(jsonBytes);
      const payload = JSON.parse(jsonStr);

      const chatMessage: ChatMessage = {
        id: Math.random().toString(36).substring(2, 15),
        sender: userName,
        senderId: localUserId, // Add unique sender ID
        timestamp: Date.now(),
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        salt: payload.salt,
        expiresAt: Date.now() + expiryTime * 1000
      };

      socketRef.current.emit('send-message', { roomId: roomCode, message: chatMessage });
      
      // Add locally
      const decrypted = await decryptIncomingMessage(chatMessage);
      setMessages(prev => [...prev, decrypted]);

    } catch (err) {
      console.error('Failed to send message', err);
      setError('Failed to send message');
      setNewMessage(messageText); // Restore input
    } finally {
      setIsSending(false);
    }
  };

  const handleLeaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setInRoom(false);
    setMessages([]);
    setParticipants([]);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </button>

      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-10 shadow-sm border border-zinc-200 dark:border-zinc-800 min-h-[600px] flex flex-col">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold flex items-center gap-3">
            <MessageSquare className="w-6 h-6 text-indigo-500" />
            Secret Chat
          </h2>
          {inRoom && (
            <button
              onClick={handleLeaveRoom}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Leave Room
            </button>
          )}
        </div>

        {!inRoom ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full"
          >
            <div className="text-center mb-8">
              <p className="text-zinc-500 dark:text-zinc-400">
                Join a secure, end-to-end encrypted chat room. Messages are encrypted in your browser before sending.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Chat Room Code</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Key className="w-4 h-4 text-zinc-400" />
                  </div>
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    placeholder="Enter room code..."
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
                <button
                  onClick={handleGenerateRoom}
                  className="px-4 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium transition-colors flex items-center gap-2"
                  title="Generate secure room code"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Your Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="w-4 h-4 text-zinc-400" />
                </div>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your display name..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="mb-8">
              <label className="block text-sm font-medium mb-2">Chat Duration</label>
              <div className="grid grid-cols-3 gap-2">
                {EXPIRY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm",
                      expiryTime === opt.value
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-300 font-medium"
                        : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    )}
                  >
                    <input
                      type="radio"
                      name="expiryTime"
                      value={opt.value}
                      checked={expiryTime === opt.value}
                      onChange={() => setExpiryTime(opt.value)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="mb-6 p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-sm text-center flex flex-col gap-2">
                <span>{error}</span>
                <button 
                  onClick={handleJoinRoom}
                  className="text-xs font-bold underline hover:no-underline"
                >
                  Try Again
                </button>
              </div>
            )}

            <button
              onClick={handleJoinRoom}
              disabled={connectionStatus === 'connecting'}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {connectionStatus === 'connecting' ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <MessageSquare className="w-5 h-5" />
              )}
              {connectionStatus === 'connecting' ? 'Connecting...' : 'Join Secret Chat'}
            </button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col md:flex-row gap-6 h-full"
          >
            {/* Sidebar for Participants */}
            <div className="w-full md:w-64 flex-shrink-0 flex flex-col gap-4">
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full animate-pulse",
                      connectionStatus === 'connected' ? "bg-emerald-500" : "bg-red-500"
                    )} />
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      Room: <span className="font-mono text-zinc-900 dark:text-zinc-100">{roomCode}</span>
                    </span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400">
                    {connectionStatus}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <Clock className="w-4 h-4" />
                  <span>Timer: {EXPIRY_OPTIONS.find(o => o.value === expiryTime)?.label}</span>
                </div>
              </div>

              <div className="flex-1 p-4 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-y-auto">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Participants ({participants.length})
                </h3>
                <ul className="space-y-2">
                  {participants.map(p => (
                    <li key={p.id} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-medium text-xs">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{p.name} {p.name === userName && "(You)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto mb-4 space-y-4 p-2 min-h-[300px] max-h-[500px]">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                    No messages yet. Start the conversation!
                  </div>
                ) : (
                  messages.map((msg) => {
                    const timeLeft = Math.max(0, Math.ceil((msg.expiresAt - Date.now()) / 1000));
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex flex-col max-w-[80%]",
                          msg.isSelf ? "ml-auto items-end" : "mr-auto items-start"
                        )}
                      >
                        {!msg.isSelf && (
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 ml-1">
                            {msg.sender}
                          </span>
                        )}
                        <div
                          className={cn(
                            "px-4 py-2 rounded-2xl relative group",
                            msg.isSelf
                              ? "bg-indigo-600 text-white rounded-br-sm"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-sm"
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-1 px-1">
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeLeft}s
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type an encrypted message..."
                  className="flex-1 px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim() || isSending}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSending ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
