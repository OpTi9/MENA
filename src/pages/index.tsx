import Head from "next/head";
import { useState } from "react";
import { CardanoWallet, MeshBadge } from "@meshsdk/react";
import { MeshWallet } from '@meshsdk/core';

export default function Home() {
  const [walletCount, setWalletCount] = useState("");
  const [showDownload, setShowDownload] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<Array<{
    walletNumber: string;
    walletName: string;
    donorAddress?: string;
    status: 'success' | 'error' | 'pending';
    message?: string;
    error?: string;
    solutionsConsolidated?: number;
  }>>([]);
  const [showConsolidation, setShowConsolidation] = useState(true);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const handleGenerateCSV = () => {
    const count = parseInt(walletCount);
    if (isNaN(count) || count <= 0) {
      alert("Please enter a valid number of wallets");
      return;
    }
    setShowDownload(true);
  };

  const downloadCSVTEmplate = () => {
    const count = parseInt(walletCount);
    let csvContent = "WalletNumber,MnemonicPhrase,WalletName\n";

    for (let i = 1; i <= count; i++) {
      csvContent += `${i},"","Wallet ${i}"\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'scavenger_consolidation_template.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setUploadedFile(file);
    } else {
      alert("Please upload a valid CSV file");
    }
  };

  const parseCSV = async (file: File): Promise<Array<{
    walletNumber: string;
    mnemonic: string;
    walletName: string;
  }>> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());

        const wallets = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          if (values.length >= 2 && values[1].trim()) {
            wallets.push({
              walletNumber: values[0].trim(),
              mnemonic: values[1].replace(/"/g, '').trim(),
              walletName: values[2]?.replace(/"/g, '').trim() || `Wallet ${i}`
            });
          }
        }
        resolve(wallets);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const callConsolidationAPI = async (recipient: string, donor: string, signature: string) => {
    // Use our own API route to bypass CORS
    let attempts = 0;
    const maxAttempts = 3;
    const baseDelay = 20000;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch('/api/consolidate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipient, donor, signature })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('API Success:', result);
          return { success: true, data: result };
        } else if (response.status === 429 || response.status === 408) {
          attempts++;
          if (attempts < maxAttempts) {
            const delay = baseDelay * Math.pow(2, attempts - 1);
            console.log(`Rate limited attempt ${attempts}, retrying in ${delay/1000}s...`);
            await sleep(delay);
            continue;
          }
        } else {
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();

            switch (response.status) {
              case 409:
                errorMessage = '409 Conflict: You already donated from this address - no action needed';
                break;
              case 400:
                errorMessage = '400 Bad Request: Invalid signature - ensure message format is exact';
                break;
              case 404:
                errorMessage = '404 Not Found: Address not registered in Scavenger Mine';
                break;
              default:
                errorMessage = errorData.error || errorData.message || errorMessage;
            }
          } catch {
            errorMessage += `: ${response.statusText}`;
          }
          return { success: false, error: errorMessage };
        }
      } catch (error) {
        attempts++;
        console.error(`Network error attempt ${attempts}:`, error);
        if (attempts < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempts - 1);
          await sleep(delay);
          continue;
        }
        return { success: false, error: `Network error after ${maxAttempts} attempts: ${error}` };
      }
    }

    return { success: false, error: 'Max retry attempts reached' };
  };

  const processConsolidation = async () => {
    if (!uploadedFile || !recipientAddress) {
      alert("Please upload CSV file and enter recipient address");
      return;
    }

    setIsProcessing(true);
    setResults([]);

    try {
      const wallets = await parseCSV(uploadedFile);
      console.log(`Processing ${wallets.length} wallets...`);

      const processResults = [];

      for (let i = 0; i < wallets.length; i++) {
        const walletData = wallets[i];

        try {
          console.log(`Processing wallet ${walletData.walletNumber}: ${walletData.walletName}`);

          const meshWallet = new MeshWallet({
            networkId: 1,
            key: {
              type: 'mnemonic',
              words: walletData.mnemonic.trim().split(' ')
            }
          });

          await meshWallet.init();
          const donorAddress = await meshWallet.getChangeAddress();

          const message = `Assign accumulated Scavenger rights to: ${recipientAddress}`;
          const signatureResult = await meshWallet.signData(message, donorAddress);

          console.log('Signature result:', signatureResult);

          if (!signatureResult) {
            throw new Error('Failed to sign message');
          }

          // Handle different return types from MeshSDK signData
          let signature: string;
          if (typeof signatureResult === 'string') {
            signature = signatureResult;
          } else if (typeof signatureResult === 'object' && signatureResult && 'signature' in signatureResult) {
            signature = (signatureResult as { signature: string }).signature;
          } else {
            throw new Error('Invalid signature format');
          }

          const apiResult = await callConsolidationAPI(
            recipientAddress,
            donorAddress,
            signature
          );

          const successStatus = apiResult.success ? 'success' as const : 'error' as const;
          processResults.push({
            walletNumber: walletData.walletNumber,
            walletName: walletData.walletName,
            donorAddress: donorAddress,
            status: successStatus,
            message: apiResult.success ?
              apiResult.data.message :
              apiResult.error,
            solutionsConsolidated: apiResult.success ?
              apiResult.data.solutions_consolidated : 0
          });

        } catch (error) {
          const errorStatus = 'error' as const;
          processResults.push({
            walletNumber: walletData.walletNumber,
            walletName: walletData.walletName,
            status: errorStatus,
            error: `Processing failed: ${error}`
          });
        }

        setResults([...processResults]);

        if (i < wallets.length - 1) {
          await sleep(2000);
        }
      }

    } catch (error) {
      console.error('Processing failed:', error);
      alert(`Processing failed: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-gray-900 w-full text-white text-center">
      <Head>
        <title>Mesh App on Cardano</title>
        <meta name="description" content="A Cardano dApp powered my Mesh" />
      </Head>
      <main className="min-h-screen p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-thin mb-8 text-center">
            <a href="https://meshjs.dev/" className="text-sky-600 font-bold text-5xl">
              M
            </a>
            idnight{" "}

            <a href="https://meshjs.dev/" className="text-sky-600 font-bold text-5xl">
              E
            </a>
            xchange{" "}
            <a href="https://meshjs.dev/" className="text-sky-600 font-bold text-5xl">
              N
            </a>
            etwork{" "}
            
            <a href="https://meshjs.dev/" className="text-sky-600 font-bold text-5xl">
              A
            </a>{" "}
            lgorithm
          </h1>

          {/* Toggle between regular wallet and consolidation */}
          <div className="flex justify-center mb-8">
            <div className="bg-gray-800 rounded-lg p-1 inline-flex">
              <button
                onClick={() => setShowConsolidation(true)}
                className={`px-6 py-2 rounded transition ${
                  showConsolidation ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Consolidation Tool
              </button>
            </div>
          </div>

          {!showConsolidation ? (
            <div className="text-center">
              <CardanoWallet />
              <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 content-center justify-around">
                <a
                  href="https://meshjs.dev/apis"
                  className="bg-gray-800 rounded-xl border border-white hover:scale-105 transition max-w-96 p-5 m-5"
                >
                  <h2 className="text-2xl font-bold mb-2">Documentation</h2>
                  <p className="text-gray-400">
                    Our documentation provide live demos and code samples; great
                    educational tool for learning how Cardano works.
                  </p>
                </a>

                <a
                  href="https://meshjs.dev/guides"
                  className="bg-gray-800 rounded-xl border border-white hover:scale-105 transition max-w-96 p-5 m-5"
                >
                  <h2 className="text-2xl font-bold mb-2">Guides</h2>
                  <p className="text-gray-400">
                    Whether you are launching a new NFT project or ecommerce store,
                    these guides will help you get started.
                  </p>
                </a>

                <a
                  href="https://meshjs.dev/smart-contracts"
                  className="bg-gray-800 rounded-xl border border-white hover:scale-105 transition max-w-96 p-5 m-5"
                >
                  <h2 className="text-2xl font-bold mb-2">Smart Contracts</h2>
                  <p className="text-gray-400">
                    Open-source smart contracts, complete with documentation, live
                    demos, and end-to-end source code.
                  </p>
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Step 1: Wallet Count */}
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-2xl font-semibold mb-4">Step 1: How many wallets do you need to consolidate?</h2>
                <p className="text-gray-400 mb-4">
                  Enter the number of wallets that participated in Scavenger Mine and need to be consolidated into a single recipient address.
                </p>
                <div className="flex gap-4">
                  <input
                    type="number"
                    value={walletCount}
                    onChange={(e) => setWalletCount(e.target.value)}
                    placeholder="Enter number of wallets"
                    className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                    min="1"
                    max="1000"
                  />
                  <button
                    onClick={handleGenerateCSV}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold"
                  >
                    Generate Template
                  </button>
                </div>
              </div>

              {/* Step 2: Download Template */}
              {showDownload && (
                <div className="bg-gray-800 rounded-lg p-6">
                  <h2 className="text-2xl font-semibold mb-4">Step 2: Download CSV Template</h2>
                  <p className="text-gray-400 mb-4">
                    Download the CSV template and fill in your mnemonic phrases for each wallet. Make sure each mnemonic phrase is complete and accurate.
                  </p>
                  <button
                    onClick={downloadCSVTEmplate}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded font-semibold"
                  >
                    Download CSV Template
                  </button>
                </div>
              )}

              {/* Step 3: Upload Filled CSV */}
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-2xl font-semibold mb-4">Step 3: Upload Filled CSV</h2>
                <p className="text-gray-400 mb-4">
                  Upload the CSV file with your mnemonic phrases filled in. The file should contain wallet numbers, mnemonic phrases, and optional wallet names.
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                />
                {uploadedFile && (
                  <p className="mt-2 text-green-400">✓ File uploaded: {uploadedFile.name}</p>
                )}
              </div>

              {/* Step 4: Recipient Address */}
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-2xl font-semibold mb-4">Step 4: Recipient Address</h2>
                <p className="text-gray-400 mb-4">
                  Enter the Cardano address that will receive all consolidated NIGHT tokens. This must be a Scavenger Mine-registered destination address.
                </p>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="addr1q..."
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono"
                />
              </div>

              {/* Process Button */}
              <div className="bg-gray-800 rounded-lg p-6">
                <button
                  onClick={processConsolidation}
                  disabled={!uploadedFile || !recipientAddress || isProcessing}
                  className={`w-full py-3 rounded font-semibold text-white ${
                    isProcessing
                      ? 'bg-gray-600 cursor-not-allowed'
                      : uploadedFile && recipientAddress
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-gray-600 cursor-not-allowed'
                  }`}
                >
                  {isProcessing ? 'Processing Consolidation...' : 'Start Consolidation Process'}
                </button>
              </div>

              {/* Results */}
              {results.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-6">
                  <h2 className="text-2xl font-semibold mb-4">Processing Results</h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {results.map((result, index) => (
                      <div key={index} className="bg-gray-700 p-3 rounded">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-semibold">Wallet {result.walletNumber}: {result.walletName}</span>
                            {result.donorAddress && (
                              <div className="text-xs text-gray-400 font-mono mt-1">
                                {result.donorAddress.slice(0, 20)}...{result.donorAddress.slice(-10)}
                              </div>
                            )}
                          </div>
                          <div className={`px-3 py-1 rounded text-sm ${
                            result.status === 'success' ? 'bg-green-600' :
                            result.status === 'error' ? 'bg-red-600' :
                            'bg-yellow-600'
                          }`}>
                            {result.status === 'success' ? '✓ Success' :
                             result.status === 'error' ? '✗ Error' :
                             '⏳ Pending'}
                          </div>
                        </div>
                        <div className="text-sm">
                          {result.status === 'success' ? (
                            <div>
                              <div className="text-green-400">{result.message}</div>
                              {(result.solutionsConsolidated && result.solutionsConsolidated > 0) && (
                                <div className="text-gray-400">
                                  Solutions consolidated: {result.solutionsConsolidated}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-red-400">{result.error || result.message}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <footer className="p-8 border-t border-gray-300 flex justify-center">
        <MeshBadge isDark={true} />
      </footer>
    </div>
  );
}
