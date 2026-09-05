import React from "react";

interface RejectedDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rejectedItems: { surface: string; claimText: string; reason: string }[];
  verifiedCount: number;
}

export const RejectedDrawer: React.FC<RejectedDrawerProps> = ({
  isOpen,
  onClose,
  rejectedItems,
  verifiedCount,
}) => {
  if (!isOpen) return null;

  return (
    <div className="rejected-drawer">
      <div className="drawer-topline">
        <h4>🛡️ SEC Automated Citation Verification Gate</h4>
        <button type="button" className="close-drawer-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <p>
        The verification gate intercepts every LLM finding, claim, and debate argument. If an LLM
        hallucinates a figure, references a competitor's filing, or cites a non-existent calculation ID,
        it is rejected against the database in sub-5ms before reaching the user.
      </p>

      {rejectedItems.length > 0 ? (
        <div style={{ marginTop: "14px" }}>
          <h5 style={{ color: "#fecaca", fontSize: "12px", textTransform: "uppercase", marginBottom: "8px" }}>
            Intercepted & Stripped Items in Current Session:
          </h5>
          <ul style={{ paddingLeft: "20px" }}>
            {rejectedItems.map((item, idx) => (
              <li key={idx} style={{ marginBottom: "8px", fontSize: "13px" }}>
                <strong>[{item.surface.toUpperCase()}]</strong> {item.claimText}
                <small style={{ display: "block", color: "#f87171" }}>Reason: {item.reason}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={{ marginTop: "10px", color: "#86efac", fontSize: "13px" }}>
          ✓ All {verifiedCount} statements in this active investigation matched verified database 10-K figures with zero hallucinated references.
        </p>
      )}
    </div>
  );
};
