// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/**
 * @title AggregateSentimentSignals
 * @notice Add-only aggregate sentiment-signal counters for MyDayWas (M2 architecture
 *         §2, OBS-75 `privacy-architecture-m2` rev 4a832d29).
 *
 *         PRIVACY CONTRACT — READ BEFORE CHANGING:
 *         - This contract stores ONLY aggregate per-UTC-day sentiment counts. There is
 *           NO per-user storage, NO per-user readers, NO per-user attribution, and no
 *           entry content of any kind, by design.
 *         	- The only addresses ever seen by this contract are the relayer EOA and the
 *           owner; end users never transact with it.
 *         	- k-anonymity (k >= 100 distinct contributors per (dayId, sentiment) cell),
 *           the T+24h publication delay, and below-k suppression are enforced by the
 *         	relayer BEFORE anything is committed here; the chain only ever sees
 *         	already-suppressed aggregate deltas. The contract cannot verify these
 *         	properties — they are audited at the relayer and reviewed by the CISO (R9)
 *         	and the Chief Auditor.
 *
 *         PROVENANCE: fresh implementation for M4 (OBS-83). The recovered
 *         `EmotionalDiary.sol` @ a587a12 is a reference prototype only; it is NOT
 *         reused here and MUST NOT be deployed (per-user ciphertext on-chain,
 *         `getUserEntriesFor` enumeration, `EntryAdded(msg.sender)` attribution bug).
 *         This contract has no ERC-2771 forwarder surface because no user or
 *         meta-transaction ever reaches it — the sole caller is the relayer EOA, so
 *         role gating uses `msg.sender` directly (smaller audit surface than the
 *         M2 sketch's ERC-2771 base, same security property for role-only gating).
 */
contract AggregateSentimentSignals {
    /// @notice Sentiment enum order is fixed: 0 = POSITIVE, 1 = NEGATIVE, 2 = NEUTRAL.
    uint8 public constant SENTIMENTS = 3;

    address public owner;
    /// @notice Pending two-step ownership transfer target (0 = none pending).
    address public pendingOwner;
    /// @notice Sole address allowed to call `recordBatch` (the relayer EOA).
    address public relayer;
    /// @notice Paused state; when true `recordBatch` reverts (incident brake).
    bool public paused;

    /// @dev counts[dayId][sentiment] — aggregate add-only counters per (UTC day, sentiment) cell.
    mapping(uint32 dayId => mapping(uint8 sentiment => uint24)) public counts;
    /// @dev Total number of signals ever committed (sum of all deltas).
    uint256 public totalSignals;

    /**
     * @notice Emitted for each committed batch. Aggregate-only: day, per-sentiment
     *         deltas, and the relayer-attested number of distinct contributors behind
     *         the published cells. No user field, no address, no content.
     */
    event BatchRecorded(
        uint32 indexed dayId,
        uint24 positiveDelta,
        uint24 negativeDelta,
        uint24 neutralDelta,
        uint24 publishedContributors
    );

    event OwnershipProposed(address indexed currentOwner, address indexed proposedOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RelayerSet(address indexed previousRelayer, address indexed newRelayer);
    event Paused(address indexed actor);
    event Unpaused(address indexed actor);

    error NotOwner();
    error NotPendingOwner();
    error NotRelayer();
    error ContractPaused();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address owner_, address relayer_) {
        if (owner_ == address(0) || relayer_ == address(0)) revert ZeroAddress();
        owner = owner_;
        relayer = relayer_;
        emit OwnershipTransferred(address(0), owner_);
        emit RelayerSet(address(0), relayer_);
    }

    /**
     * @notice Add-only batch commit of suppressed aggregate sentiment deltas for one
     *         UTC day. Callable by the relayer only. Counts never decrease.
     * @param dayId               UTC-day index (days since 1970-01-01).
     * @param sentimentDeltas     [POSITIVE, NEGATIVE, NEUTRAL] count deltas to add.
     * @param publishedContributors Relayer-attested distinct contributor count behind
     *                              the published cells (>= k threshold, off-chain).
     * @dev Deltas use checked arithmetic; a uint24 cell count overflow reverts
     *      (bounds each cell at 2^24 − 1 ≈ 16.7M lifetime signals, far above the v1 scale).
     */
    function recordBatch(
        uint32 dayId,
        uint24[SENTIMENTS] calldata sentimentDeltas,
        uint24 publishedContributors
    ) external onlyRelayer whenNotPaused {
        mapping(uint8 sentiment => uint24) storage cell = counts[dayId];
        cell[0] += sentimentDeltas[0];
        cell[1] += sentimentDeltas[1];
        cell[2] += sentimentDeltas[2];
        totalSignals += uint256(sentimentDeltas[0]) + sentimentDeltas[1] + sentimentDeltas[2];
        emit BatchRecorded(
            dayId,
            sentimentDeltas[0],
            sentimentDeltas[1],
            sentimentDeltas[2],
            publishedContributors
        );
    }

    /// @notice Aggregate counts for one UTC day, [POSITIVE, NEGATIVE, NEUTRAL].
    function getCounts(uint32 dayId) external view returns (uint24[SENTIMENTS] memory out) {
        mapping(uint8 sentiment => uint24) storage cell = counts[dayId];
        out[0] = cell[0];
        out[1] = cell[1];
        out[2] = cell[2];
    }

    /// @notice Lifetime total signals committed across all days.
    function getTotalSignals() external view returns (uint256) {
        return totalSignals;
    }

    /// @notice Replace the relayer EOA. Two-step is unnecessary: owner is the only
    ///         writer and the relayer holds no user funds (add-only counters).
    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ZeroAddress();
        emit RelayerSet(relayer, newRelayer);
        relayer = newRelayer;
    }

    /// @notice Step 1 of the two-step ownership transfer. Does NOT take effect
    ///         until the proposed owner calls `acceptOwnership()`.
    function proposeOwner(address proposed) external onlyOwner {
        if (proposed == address(0)) revert ZeroAddress();
        emit OwnershipProposed(owner, proposed);
        pendingOwner = proposed;
    }

    /// @notice Step 2 of the two-step ownership transfer; caller must be the
    ///         pending owner. Replaces a587a12's raw single-step `transferOwnership`.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipProposed(owner, address(0));
        delete pendingOwner;
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
    }

    /// @notice Cancel a pending ownership proposal.
    function cancelOwnershipProposal() external onlyOwner {
        emit OwnershipProposed(owner, address(0));
        delete pendingOwner;
    }

    /// @notice Pause `recordBatch` (incident brake; views stay readable).
    function pause() external onlyOwner {
        if (paused) revert ContractPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Lift a pause.
    function unpause() external onlyOwner {
        if (!paused) revert ContractPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }
}