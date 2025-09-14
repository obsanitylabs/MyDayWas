// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/metatx/MinimalForwarder.sol";

/**
 * @title EmotionalDiary
 * @dev Smart contract for storing encrypted emotional diary entries on Japan Smart Chain
 * @dev Supports gasless transactions via ERC-2771 meta-transactions
 */
contract EmotionalDiary is ERC2771Context {
    enum Sentiment { POSITIVE, NEGATIVE, NEUTRAL }
    
    struct DiaryEntry {
        uint256 id;
        address user;
        string encryptedContent;
        Sentiment sentiment;
        uint256 timestamp;
    }

    struct SentimentCount {
        uint256 positive;
        uint256 negative;
        uint256 neutral;
    }

    mapping(address => DiaryEntry[]) private userEntries;
    mapping(address => uint256) private userEntryCount;
    
    SentimentCount private globalSentiment;
    uint256 private totalEntries;
    uint256 private nextEntryId;

    // Access control
    address private owner;
    bool private paused;
    
    // Gas sponsorship
    mapping(address => bool) public gasSponsors;
    uint256 public gasPool;
    uint256 public maxGasPerEntry;

    modifier onlyOwner() {
        require(_msgSender() == owner, "Only owner can call this function");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    modifier onlyGasSponsor() {
        require(gasSponsors[_msgSender()] || _msgSender() == owner, "Not authorized gas sponsor");
        _;
    }

    event EntryAdded(
        address indexed user,
        uint256 indexed entryId,
        Sentiment sentiment,
        uint256 timestamp
    );

    event SentimentUpdated(
        uint256 positive,
        uint256 negative,
        uint256 neutral,
        uint256 total
    );

    event ContractPaused();
    event ContractUnpaused();
    event GasPoolFunded(address indexed sponsor, uint256 amount);
    event GasSponsorAdded(address indexed sponsor);
    event GasSponsorRemoved(address indexed sponsor);

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {
        owner = msg.sender;
        paused = false;
        nextEntryId = 1;
        maxGasPerEntry = 100000; // Default max gas per entry
        gasSponsors[msg.sender] = true; // Owner is default gas sponsor
    }
    
    /**
     * @dev Override _msgSender to support meta-transactions
     */
    function _msgSender() internal view override(Context, ERC2771Context) returns (address sender) {
        return ERC2771Context._msgSender();
    }
    
    /**
     * @dev Override _msgData to support meta-transactions
     */
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    /**
     * @dev Add a new encrypted diary entry
     * @param _encryptedContent The encrypted content of the diary entry
     * @param _sentiment The sentiment classification (0=POSITIVE, 1=NEGATIVE, 2=NEUTRAL)
     * @param _timestamp The timestamp when the entry was created
     * @return The ID of the created entry
     */
    function addEntry(
        string memory _encryptedContent,
        Sentiment _sentiment,
        uint256 _timestamp
    ) external whenNotPaused returns (uint256) {
        require(bytes(_encryptedContent).length > 0, "Content cannot be empty");
        require(_timestamp <= block.timestamp, "Timestamp cannot be in the future");
        require(uint8(_sentiment) <= 2, "Invalid sentiment value");

        uint256 entryId = nextEntryId++;
        
        DiaryEntry memory newEntry = DiaryEntry({
            id: entryId,
            user: _msgSender(),
            encryptedContent: _encryptedContent,
            sentiment: _sentiment,
            timestamp: _timestamp
        });

        userEntries[_msgSender()].push(newEntry);
        userEntryCount[_msgSender()]++;
        totalEntries++;

        // Update global sentiment counts
        if (_sentiment == Sentiment.POSITIVE) {
            globalSentiment.positive++;
        } else if (_sentiment == Sentiment.NEGATIVE) {
            globalSentiment.negative++;
        } else {
            globalSentiment.neutral++;
        }

        emit EntryAdded(msg.sender, entryId, _sentiment, _timestamp);
        emit SentimentUpdated(
            globalSentiment.positive,
            globalSentiment.negative,
            globalSentiment.neutral,
            totalEntries
        );

        return entryId;
    }
    
    /**
     * @dev Add entry with gas sponsorship
     */
    function addEntryGasless(
        string memory _encryptedContent,
        Sentiment _sentiment,
        uint256 _timestamp,
        address _user,
        uint256 _gasLimit
    ) external onlyGasSponsor whenNotPaused returns (uint256) {
        require(bytes(_encryptedContent).length > 0, "Content cannot be empty");
        require(_timestamp <= block.timestamp, "Timestamp cannot be in the future");
        require(uint8(_sentiment) <= 2, "Invalid sentiment value");
        require(_gasLimit <= maxGasPerEntry, "Gas limit too high");
        require(gasPool >= _gasLimit, "Insufficient gas pool");
        
        // Deduct from gas pool
        gasPool -= _gasLimit;
        
        uint256 entryId = nextEntryId++;
        
        DiaryEntry memory newEntry = DiaryEntry({
            id: entryId,
            user: _user,
            encryptedContent: _encryptedContent,
            sentiment: _sentiment,
            timestamp: _timestamp
        });

        userEntries[_user].push(newEntry);
        userEntryCount[_user]++;
        totalEntries++;

        // Update global sentiment counts
        if (_sentiment == Sentiment.POSITIVE) {
            globalSentiment.positive++;
        } else if (_sentiment == Sentiment.NEGATIVE) {
            globalSentiment.negative++;
        } else {
            globalSentiment.neutral++;
        }

        emit EntryAdded(_user, entryId, _sentiment, _timestamp);
        emit SentimentUpdated(
            globalSentiment.positive,
            globalSentiment.negative,
            globalSentiment.neutral,
            totalEntries
        );

        return entryId;
    }

    /**
     * @dev Get all diary entries for the caller (msg.sender only)
     * @return Array of diary entries
     */
    function getUserEntries() external view returns (DiaryEntry[] memory) {
        return userEntries[_msgSender()];
    }
    
    /**
     * @dev Get entries for a specific user (gasless version)
     */
    function getUserEntriesFor(address _user) external view returns (DiaryEntry[] memory) {
        return userEntries[_user];
    }

    /**
     * @dev Get paginated diary entries for the caller
     * @param _offset Starting index for pagination
     * @param _limit Maximum number of entries to return
     * @return Array of diary entries
     */
    function getUserEntriesPaginated(
        uint256 _offset,
        uint256 _limit
    ) external view returns (DiaryEntry[] memory) {
        require(_limit > 0 && _limit <= 100, "Invalid limit (1-100)");
        
        DiaryEntry[] storage allEntries = userEntries[_msgSender()];
        uint256 totalUserEntries = allEntries.length;
        
        if (_offset >= totalUserEntries) {
            return new DiaryEntry[](0);
        }
        
        uint256 end = _offset + _limit;
        if (end > totalUserEntries) {
            end = totalUserEntries;
        }
        
        uint256 resultLength = end - _offset;
        DiaryEntry[] memory result = new DiaryEntry[](resultLength);
        
        for (uint256 i = 0; i < resultLength; i++) {
            result[i] = allEntries[_offset + i];
        }
        
        return result;
    }

    /**
     * @dev Get the number of entries for the caller
     * @return Number of entries
     */
    function getUserEntryCount() external view returns (uint256) {
        return userEntryCount[_msgSender()];
    }
    
    /**
     * @dev Fund the gas pool for sponsoring transactions
     */
    function fundGasPool() external payable onlyGasSponsor {
        require(msg.value > 0, "Must send JETH to fund pool");
        gasPool += msg.value;
        emit GasPoolFunded(_msgSender(), msg.value);
    }
    
    /**
     * @dev Add a gas sponsor
     */
    function addGasSponsor(address _sponsor) external onlyOwner {
        gasSponsors[_sponsor] = true;
        emit GasSponsorAdded(_sponsor);
    }
    
    /**
     * @dev Remove a gas sponsor
     */
    function removeGasSponsor(address _sponsor) external onlyOwner {
        gasSponsors[_sponsor] = false;
        emit GasSponsorRemoved(_sponsor);
    }
    
    /**
     * @dev Set maximum gas per entry
     */
    function setMaxGasPerEntry(uint256 _maxGas) external onlyOwner {
        maxGasPerEntry = _maxGas;
    }
    
    /**
     * @dev Get gas pool balance
     */
    function getGasPoolBalance() external view returns (uint256) {
        return gasPool;
    }
    
    /**
     * @dev Withdraw from gas pool (owner only)
     */
    function withdrawGasPool(uint256 _amount) external onlyOwner {
        require(_amount <= gasPool, "Insufficient gas pool balance");
        gasPool -= _amount;
        payable(owner).transfer(_amount);
    }

    /**
     * @dev Get global sentiment statistics
     * @return positive Number of positive entries
     * @return negative Number of negative entries
     * @return neutral Number of neutral entries
     */
    function getGlobalSentiment() external view returns (
        uint256 positive,
        uint256 negative,
        uint256 neutral
    ) {
        return (
            globalSentiment.positive,
            globalSentiment.negative,
            globalSentiment.neutral
        );
    }

    /**
     * @dev Get total number of entries across all users
     * @return Total number of entries
     */
    function getTotalEntries() external view returns (uint256) {
        return totalEntries;
    }

    /**
     * @dev Get recent sentiment data for analytics (anonymized)
     * @param _limit Maximum number of recent entries to analyze
     * @return sentiments Array of recent sentiment values
     * @return timestamps Array of corresponding timestamps
     */
    function getRecentSentimentData(uint256 _limit) external view returns (
        Sentiment[] memory sentiments,
        uint256[] memory timestamps
    ) {
        require(_limit > 0 && _limit <= 100, "Invalid limit (1-100)");
        
        // This is a simplified implementation that would need optimization
        // In production, consider maintaining a separate array for recent entries
        sentiments = new Sentiment[](_limit);
        timestamps = new uint256[](_limit);
        
        // Return empty arrays for now - would need more complex logic
        // to aggregate recent entries from all users while maintaining privacy
        
        return (sentiments, timestamps);
    }

    /**
     * @dev Pause the contract (only owner)
     */
    function pause() external onlyOwner {
        paused = true;
        emit ContractPaused();
    }

    /**
     * @dev Unpause the contract (only owner)
     */
    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused();
    }

    /**
     * @dev Check if contract is paused
     * @return Current pause status
     */
    function isPaused() external view returns (bool) {
        return paused;
    }

    /**
     * @dev Get contract owner
     * @return Owner address
     */
    function getOwner() external view returns (address) {
        return owner;
    }

    /**
     * @dev Transfer ownership (only current owner)
     * @param _newOwner New owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "New owner cannot be zero address");
        owner = _newOwner;
    }
}