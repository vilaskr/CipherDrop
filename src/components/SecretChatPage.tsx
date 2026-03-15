import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MessageSquare, Key, RefreshCw, Send, LogOut, Trash2, Clock } from 'lucide-react';
import { encryptData, decryptData, generateSecureKey } from '../lib/crypto';
import { cn } from '../lib/utils';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface Message {
  id: string;
  text: string;
  authorUID: string;
  createdAt: Date | null;
  isSelf: boolean;
}

export default function SecretChatPage({ onBack }: { onBack: () => void }) {
  const [roomCode, setRoomCode] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState(false);
  const [localSessionId] = useState(() => Math.random().toString(36).substring(2, 15));
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<() => void>();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
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

    setError('');
    setInRoom(true);
    setMessages([]);

    const q = query(
      collection(db, 'chatRooms', roomCode, 'messages'),
      orderBy('createdAt', 'asc')
    );

    unsubscribeRef.current = onSnapshot(q, async (snapshot) => {
      const newMessages: Message[] = [];
      const removedIds: string[] = [];
      
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const data = change.doc.data();
          try {
            // Decrypt the message
            const decrypted = await decryptData(data.encryptedData, roomCode);
            const text = new TextDecoder().decode(decrypted.data);
            
            newMessages.push({
              id: change.doc.id,
              text,
              authorUID: data.authorUID,
              createdAt: data.createdAt?.toDate() || new Date(),
              isSelf: data.authorUID === localSessionId
            });
          } catch (err) {
            console.error('Failed to decrypt message', err);
            newMessages.push({
              id: change.doc.id,
              text: '[Encrypted message - wrong room code or corrupted]',
              authorUID: data.authorUID,
              createdAt: data.createdAt?.toDate() || new Date(),
              isSelf: data.authorUID === localSessionId
            });
          }
        } else if (change.type === 'removed') {
          removedIds.push(change.doc.id);
        }
      }
      
      setMessages(prev => {
        let updated = [...prev];
        if (removedIds.length > 0) {
          updated = updated.filter(m => !removedIds.includes(m.id));
        }
        if (newMessages.length > 0) {
          updated = [...updated, ...newMessages];
          // Remove duplicates based on ID
          const unique = Array.from(new Map(updated.map(item => [item.id, item])).values());
          updated = unique.sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
        }
        return updated;
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `chatRooms/${roomCode}/messages`);
    });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setIsSending(true);
    const messageText = newMessage;
    setNewMessage('');

    try {
      const dataToEncrypt = new TextEncoder().encode(messageText);
      const encryptedData = await encryptData(dataToEncrypt, roomCode, 'text');

      const docRef = await addDoc(collection(db, 'chatRooms', roomCode, 'messages'), {
        encryptedData,
        authorUID: localSessionId,
        createdAt: serverTimestamp()
      });

      if (selfDestruct) {
        // Delete the message after 10 seconds
        setTimeout(async () => {
          try {
            await deleteDoc(doc(db, 'chatRooms', roomCode, 'messages', docRef.id));
            setMessages(prev => prev.filter(m => m.id !== docRef.id));
          } catch (err) {
            console.error('Failed to self-destruct message', err);
          }
        }, 10000);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chatRooms/${roomCode}/messages`);
      setError('Failed to send message');
      setNewMessage(messageText); // Restore input
    } finally {
      setIsSending(false);
    }
  };

  const handleLeaveRoom = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }
    setInRoom(false);
    setMessages([]);
    setRoomCode('');
  };

  const handleDeleteMessage = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'chatRooms', roomCode, 'messages', id));
      setMessages(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error('Failed to delete message', err);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
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

            <div className="mb-6">
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
              Join Secret Chat
            </button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col h-full"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Room: <span className="font-mono text-zinc-900 dark:text-zinc-100">{roomCode}</span>
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={selfDestruct}
                  onChange={(e) => setSelfDestruct(e.target.checked)}
                  className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Self-destruct (10s)</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 space-y-4 p-2 min-h-[300px] max-h-[500px]">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                  No messages yet. Start the conversation!
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex flex-col max-w-[80%]",
                      msg.isSelf ? "ml-auto items-end" : "mr-auto items-start"
                    )}
                  >
                    <div
                      className={cn(
                        "px-4 py-2 rounded-2xl relative group",
                        msg.isSelf
                          ? "bg-indigo-600 text-white rounded-br-sm"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-sm"
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                      
                      {msg.isSelf && (
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="absolute -left-8 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete message"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-400 mt-1 px-1">
                      {msg.createdAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
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
          </motion.div>
        )}
      </div>
    </div>
  );
}
