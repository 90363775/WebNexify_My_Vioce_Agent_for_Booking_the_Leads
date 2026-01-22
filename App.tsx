import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { GEMINI_MODEL, SYSTEM_INSTRUCTION } from './constants';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';
import { ConnectionStatus } from './types';
import Header from './components/Header';
import Visualizer from './components/Visualizer';

// Live API specific configuration
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Audio Refs
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null); // For visualizer state

  // Initialize GenAI
  // Note: In a real app, API_KEY should be handled securely.
  // The prompt instructs to assume process.env.API_KEY is available.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

  const disconnect = useCallback(() => {
    // Close Audio Contexts
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }

    // Stop Microphone Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Disconnect Processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Try to close session if possible (wrapper doesn't expose explicit close easily without ref handling, 
    // but stopping stream stops input)
    // There isn't a direct .close() on the session promise result in the snippet provided, 
    // but the connection is effectively severed when contexts die.
    
    // Reset State
    sessionPromiseRef.current = null;
    nextStartTimeRef.current = 0;
    setStatus(ConnectionStatus.DISCONNECTED);
    setAnalyser(null);
  }, []);

  const connect = async () => {
    try {
      setErrorMsg(null);
      setStatus(ConnectionStatus.CONNECTING);

      // 1. Setup Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: INPUT_SAMPLE_RATE
      });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE
      });

      // Setup Analyser for Visualizer (on Output)
      const analyserNode = outputCtx.createAnalyser();
      analyserNode.fftSize = 256;
      outputAnalyserRef.current = analyserNode;
      setAnalyser(analyserNode);

      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;

      // 2. Get Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setStatus(ConnectionStatus.CONNECTED);

            // Start Audio Processing Pipeline
            const source = inputCtx.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            
            // Use ScriptProcessor for 16kHz PCM conversion and streaming
            // bufferSize: 4096, inputChannels: 1, outputChannels: 1
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              
              // Send data to model
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (base64Audio && outputCtx) {
              try {
                // Determine start time for gapless playback
                const currentTime = outputCtx.currentTime;
                if (nextStartTimeRef.current < currentTime) {
                    nextStartTimeRef.current = currentTime;
                }

                const audioBuffer = await decodeAudioData(
                  decode(base64Audio),
                  outputCtx,
                  OUTPUT_SAMPLE_RATE,
                  1
                );

                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                
                // Connect to analyser then to destination
                if (outputAnalyserRef.current) {
                  source.connect(outputAnalyserRef.current);
                  outputAnalyserRef.current.connect(outputCtx.destination);
                } else {
                  source.connect(outputCtx.destination);
                }
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;

              } catch (e) {
                console.error("Error decoding audio", e);
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              console.log("Interrupted");
              nextStartTimeRef.current = 0;
              // Note: Stopping currently playing nodes tracks is complex without a robust queue manager,
              // but resetting nextStartTime helps reset the timeline.
            }
          },
          onclose: (e) => {
            console.log("Session Closed", e);
            disconnect();
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setErrorMsg("Connection error occurred. Please try again.");
            disconnect();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (err) {
      console.error("Connection Failed", err);
      setErrorMsg("Failed to access microphone or connect to AI service.");
      disconnect();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />

      <main className="flex-grow flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="w-full max-w-lg z-10 space-y-8">
          
          <div className="text-center space-y-4">
            <div className="relative inline-block">
               <div className={`w-32 h-32 rounded-full flex items-center justify-center mx-auto transition-all duration-500 ${
                 status === ConnectionStatus.CONNECTED 
                   ? 'bg-brand-500 shadow-[0_0_50px_rgba(14,165,233,0.4)]' 
                   : 'bg-brand-900 border-4 border-gray-700'
               }`}>
                  <i className={`fa-solid fa-microphone text-4xl ${status === ConnectionStatus.CONNECTED ? 'text-white' : 'text-gray-500'}`}></i>
               </div>
               
               {/* Status Badge */}
               <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border ${
                    status === ConnectionStatus.CONNECTED
                      ? 'bg-brand-500 text-white border-brand-400'
                      : status === ConnectionStatus.CONNECTING
                        ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
                        : 'bg-gray-800 text-gray-400 border-gray-700'
                  }`}>
                    {status === ConnectionStatus.DISCONNECTED ? 'Offline' : status}
                  </span>
               </div>
            </div>

            <div className="space-y-2 mt-6">
              <h2 className="text-2xl font-bold text-white">Hello, I'm Nexa.</h2>
              <p className="text-gray-400 max-w-sm mx-auto">
                Your WebnexifyStudio voice assistant. Ask me about our AI services, development, or real estate solutions.
              </p>
            </div>
          </div>

          {/* Visualizer Area */}
          <div className="h-32 flex items-center justify-center w-full bg-gray-900/50 rounded-xl border border-gray-800 p-4 backdrop-blur-sm">
             {status === ConnectionStatus.CONNECTED ? (
               <Visualizer analyser={analyser} isActive={true} />
             ) : (
               <div className="text-gray-600 italic text-sm">Voice stream inactive</div>
             )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4 items-center">
            {errorMsg && (
              <div className="text-red-400 text-sm bg-red-900/20 px-4 py-2 rounded border border-red-900/50">
                <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                {errorMsg}
              </div>
            )}

            {status === ConnectionStatus.DISCONNECTED || status === ConnectionStatus.ERROR ? (
              <button
                onClick={connect}
                className="group relative px-8 py-4 bg-white text-brand-900 rounded-full font-bold text-lg shadow-lg hover:bg-gray-100 transition-all hover:scale-105 active:scale-95 flex items-center gap-3"
              >
                <div className="absolute inset-0 rounded-full bg-brand-400 blur opacity-20 group-hover:opacity-40 transition-opacity"></div>
                <i className="fa-solid fa-phone"></i>
                Start Conversation
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-8 py-4 bg-red-500/10 text-red-400 border border-red-500/50 rounded-full font-bold text-lg hover:bg-red-500/20 transition-all active:scale-95 flex items-center gap-3"
              >
                <i className="fa-solid fa-phone-slash"></i>
                End Call
              </button>
            )}
          </div>
          
          <div className="text-center text-xs text-gray-600 pt-8">
            <p>Powered by Google Gemini 2.5 Live API</p>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
