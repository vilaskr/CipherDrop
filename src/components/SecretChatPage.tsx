import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MessageSquare, Key, RefreshCw, Send, LogOut, Trash2, Clock, Users, User } from 'lucide-react';
import { encryptData, decryptData, generateSecureKey, base64ToBytes, bytesToBase64 } from '../lib/crypto';
import { cn } from '../lib/utils';
import { io, Socket } from 'socket.io-client';

interface ChatMessagePayload {
  sender: string;
  timestamp: number;
  ciphertext: string;
  iv: string;
  salt: string;
  expiresAt: number;
}

interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: number;
  expiresAt: number;
  isSelf: boolean;
}

export default function SecretChatPage({ onBack }: { onBack: () => void }) {
  const [roomCode, setRoomCode] = useState('');
  const [userName, setUserName] = useState('');
  const [expiryTime, setExpiryTime] = useState<number>(60); // Default 1 min
  
  const [inRoom, setInRoom] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
    setInRoom(true);
    setMessages([]);

    const socket = io();
    socketRef.current = socket;

    socket.emit('join-room', { roomCode, name: userName.trim() });

    socket.on('room-state', async ({ users, messages: encryptedMessages }: { users: string[], messages: ChatMessagePayload[] }) => {
      setConnectedUsers(users);
      
      const decryptedMessages: Message[] = [];
      for (const msg of encryptedMessages) {
        if (msg.expiresAt > Date.now()) {
          try {
            const payload = {
              version: 1,
              salt: msg.salt,
              iv: msg.iv,
              ciphertext: msg.ciphertext,
              dataType: 'text'
            };
            const encryptedString = bytesToBase64(new TextEncoder().encode(JSON.stringify(payload)));
            const decrypted = await decryptData(encryptedString, roomCode);
            const text = new TextDecoder().decode(decrypted.data);
            
            decryptedMessages.push({
              id: `${msg.sender}-${msg.timestamp}`,
              text,
              sender: msg.sender,
              timestamp: msg.timestamp,
              expiresAt: msg.expiresAt,
              isSelf: msg.sender === userName.trim()
            });
          } catch (err) {
            console.error('Failed to decrypt historical message', err);
          }
        }
      }
      setMessages(decryptedMessages.sort((a, b) => a.timestamp - b.timestamp));
    });

    socket.on('user-joined', ({ name, users }) => {
      setConnectedUsers(users);
    });

    socket.on('user-left', ({ name, users }) => {
      setConnectedUsers(users);
    });

    socket.on('new-message', async (msg: ChatMessagePayload) => {
      try {
        const payload = {
          version: 1,
          salt: msg.salt,
          iv: msg.iv,
          ciphertext: msg.ciphertext,
          dataType: 'text'
        };
        const encryptedString = bytesToBase64(new TextEncoder().encode(JSON.stringify(payload)));
        const decrypted = await decryptData(encryptedString, roomCode);
        const text = new TextDecoder().decode(decrypted.data);
        
        setMessages(prev => {
          const newMsg = {
            id: `${msg.sender}-${msg.timestamp}`,
            text,
            sender: msg.sender,
            timestamp: msg.timestamp,
            expiresAt: msg.expiresAt,
            isSelf: msg.sender === userName.trim()
          };
          // Avoid duplicates
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg].sort((a, b) => a.timestamp - b.timestamp);
        });
      } catch (err) {
        console.error('Failed to decrypt new message', err);
        setMessages(prev => {
          const newMsg = {
            id: `${msg.sender}-${msg.timestamp}`,
            text: '[Encrypted message - wrong room code or corrupted]',
            sender: msg.sender,
            timestamp: msg.timestamp,
            expiresAt: msg.expiresAt,
            isSelf: msg.sender === userName.trim()
          };
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg].sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    });

    socket.on('message-expired', ({ timestamp, sender }) => {
      setMessages(prev => prev.filter(m => m.timestamp !== timestamp || m.sender !== sender));
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
      const payload = JSON.parse(new TextDecoder().decode(base64ToBytes(encryptedString)));

      const chatMessage: ChatMessagePayload = {
        sender: userName.trim(),
        timestamp: Date.now(),
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        salt: payload.salt,
        expiresAt: Date.now() + expiryTime * 1000
      };

      socketRef.current.emit('send-message', { roomCode, message: chatMessage });
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
    setConnectedUsers([]);
  };

  // Auto-remove expired messages locally as a fallback
  useEffect(() => {
    if (messages.length > 0) {
      const hasExpired = messages.some(m => m.expiresAt <= now);
      if (hasExpired) {
        setMessages(prev => prev.filter(m => m.expiresAt > now));
      }
    }
  }, [now, messages]);

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

            <div className="space-y-5 mb-8">
              <div>
                <label className="block text-sm font-medium mb-2">Room ID</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Key className="w-4 h-4 text-zinc-400" />
                    </div>
                    <input
                      type="text"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      placeholder="Enter room ID..."
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

              <div>
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

              <div>
                <label className="block text-sm font-medium mb-2">Chat Duration</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Clock className="w-4 h-4 text-zinc-400" />
                  </div>
                  <select
                    value={expiryTime}
                    onChange={(e) => setExpiryTime(Number(e.target.value))}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                  >
                    <option value={10}>10 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={60}>1 minute</option>
                    <option value={180}>3 minutes</option>
                    <option value={300}>5 minutes</option>
                    <option value={600}>10 minutes</option>
                  </select>
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-sm text-center">
                {error}
              </div>
            )}

            <button
              onClick={handleJoinRoom}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-lg transition-colors flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-5 h-5" />
              Join Room
            </button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col h-full"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
              {/* Sidebar */}
              <div className="md:col-span-1 flex flex-col gap-4">
                <div className="bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Room ID</span>
                  </div>
                  <div className="font-mono text-sm text-zinc-900 dark:text-zinc-100 break-all bg-white dark:bg-zinc-900 p-2 rounded border border-zinc-200 dark:border-zinc-800">
                    {roomCode}
                  </div>
                </div>

                <div className="bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex-1 flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    <Users className="w-4 h-4" />
                    Participants ({connectedUsers.length})
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {connectedUsers.map((user, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-medium text-xs">
                          {user.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-zinc-900 dark:text-zinc-100 truncate">
                          {user} {user === userName.trim() && "(You)"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chat Area */}
              <div className="md:col-span-3 flex flex-col min-h-0 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                      No messages yet. Start the conversation!
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const timeLeft = Math.max(0, Math.ceil((msg.expiresAt - now) / 1000));
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col max-w-[85%]",
                            msg.isSelf ? "ml-auto items-end" : "mr-auto items-start"
                          )}
                        >
                          {!msg.isSelf && (
                            <span className="text-xs font-medium text-zinc-500 mb-1 ml-1">
                              {msg.sender}
                            </span>
                          )}
                          <div
                            className={cn(
                              "px-4 py-2 rounded-2xl relative group",
                              msg.isSelf
                                ? "bg-indigo-600 text-white rounded-br-sm"
                                : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-sm border border-zinc-200 dark:border-zinc-700 shadow-sm"
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                          </div>
                          <div className="flex items-center gap-2 mt-1 px-1">
                            <span className="text-[10px] text-zinc-400">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[10px] text-red-400 flex items-center gap-0.5">
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

                <div className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 rounded-b-xl">
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
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
