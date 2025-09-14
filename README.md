# How Are You Today? - Emotional Wellness Platform

A privacy-first emotional diary platform built on Japan Smart Chain with AI-powered analytics and gasless transactions.

## 🌟 Features

### 🔐 Privacy & Security
- **End-to-end encryption** using wallet-based signatures
- **Blockchain storage** on Japan Smart Chain (JSC)
- **Personal data redaction** - names, emails, phones automatically hidden
- **Offline-first architecture** with automatic sync

### 🧠 AI-Powered Analytics
- **Advanced sentiment analysis** with 8 core emotions
- **Personality trait analysis** (Big Five model)
- **Trend analysis** and risk assessment
- **Global mental health heat map**
- **Historical pattern recognition**

### ⛽ Gasless Transactions
- **Meta-transactions** via ERC-2771 standard
- **Gas sponsorship** for seamless user experience
- **No JETH required** for diary entries
- **Automatic gas pool management**

### 🌍 Global Analytics
- **Real-time emotional landscape** visualization
- **Regional mood tracking** with color-coded emotions:
  - 🔴 Red: Anger
  - 🟡 Yellow: Calm  
  - 🟢 Green: Harmony
  - 🔵 Blue: Happy
- **Historical records** tracking ("best day ever", "most traumatic day")
- **News event correlation** for mood pattern analysis

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MetaMask or compatible wallet
- JETH tokens for gas (or use gasless features)

### Installation
```bash
npm install
npm run dev
```

### Wallet Setup
1. Add Japan Smart Chain network to MetaMask:
   - **Network Name**: JSC Kaigan Testnet
   - **RPC URL**: `https://rpc.kaigan.jsc.dev/rpc?token=sAoK9rCEuCrO57nL_eh7xfuS6g4SJvPC_7kd-8yRj-c`
   - **Chain ID**: 5278000
   - **Currency**: JETH
   - **Explorer**: `https://explorer.kaigan.jsc.dev`

2. Get testnet JETH from the JSC faucet

### Smart Contract
- **EmotionalDiary Contract**: `0x23379e41109909f112F7619b17D403D4Cc70d589`
- **Network**: JSC Kaigan Testnet
- **Features**: Gasless transactions, privacy protection, global analytics

## 🏗️ Architecture

### Frontend
- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **Ethers.js** for blockchain interaction
- **Vite** for fast development

### Blockchain
- **Japan Smart Chain** (JSC) for low-cost transactions
- **ERC-2771** meta-transactions for gasless UX
- **Encrypted storage** with wallet-based keys

### Services
- **Wallet Service**: Multi-provider wallet connection
- **Encryption Service**: Client-side encryption/decryption
- **Analytics Service**: AI-powered emotional analysis
- **Gasless Service**: Meta-transaction handling
- **Global Analytics**: Worldwide mood tracking

## 🔧 Configuration

### Environment Variables
```bash
# Optional: WalletConnect Project ID
VITE_WALLETCONNECT_PROJECT_ID=your_project_id

# Optional: Gas Relay API Key
VITE_GAS_RELAY_API_KEY=your_api_key
```
# Optional: Relayer Private Key (for direct gasless execution)
VITE_RELAYER_PRIVATE_KEY=your_relayer_private_key

### Gas Sponsorship Setup
1. Deploy the EmotionalDiary contract with a trusted forwarder
   - Use trusted forwarder: `0x9399BB24DBB5C4b782C70c2969F58716Ebbd6a3b`
2. Fund the gas pool: `contract.fundGasPool({ value: ethers.parseEther("1.0") })`
3. Add gas sponsors: `contract.addGasSponsor(sponsorAddress)`

## 📊 Analytics Features

### Personal Analytics
- **Sentiment scoring** (-1 to 1 scale)
- **Emotion breakdown** (joy, sadness, anger, fear, etc.)
- **Personality insights** (openness, conscientiousness, etc.)
- **Readability analysis** (Flesch score, grade level)
- **Trend tracking** (improving/declining/stable)

### Global Analytics
- **Heat map visualization** of worldwide emotions
- **Historical records** with cause analysis
- **Regional mood comparison**
- **News event correlation**
- **Privacy-protected aggregation**

## 🔒 Privacy Protection

### Automatic Redaction
- Email addresses → `[EMAIL_REDACTED]`
- Phone numbers → `[PHONE_REDACTED]`
- Social media handles → `[HANDLE_REDACTED]`
- Names and addresses → `[NAME_REDACTED]`
- Ages → `[AGE_REDACTED]`

### Data Handling
- **Local encryption** before blockchain storage
- **Wallet-based keys** for decryption
- **No server storage** of personal data
- **Aggregated analytics** only

## 🌐 Deployment

### Smart Contract Deployment
1. Compile `EmotionalDiary.sol` in Remix
2. Deploy to JSC Kaigan Testnet
3. Update contract address in `japanSmartChain.ts`
4. Fund gas pool for gasless transactions

### Frontend Deployment
```bash
npm run build
# Deploy dist/ folder to your hosting provider
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- **Documentation**: Check the `/docs` folder
- **Issues**: GitHub Issues
- **Community**: Discord/Telegram (links in profile)

## 🎯 Roadmap

- [ ] Mobile app (React Native)
- [ ] Voice diary entries
- [ ] AI therapy chatbot
- [ ] Multi-language support
- [ ] Advanced ML models
- [ ] Social features (anonymous)
- [ ] Integration with health apps

---

**Remember**: Your mental health matters. This platform provides insights and support, but please seek professional help when needed. 💙