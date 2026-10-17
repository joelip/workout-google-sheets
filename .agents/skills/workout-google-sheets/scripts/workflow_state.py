#!/usr/bin/env python3
"""Atomic, duplicate-safe state transitions for the workout sheet workflow."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_snapshot(value: str) -> str:
    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()


def load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "dayRequests": {}, "inquiries": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("dayRequests", {}), dict):
        raise SystemExit("Unsupported or invalid workflow state; manual review required")
    if not isinstance(data.get("inquiries", {}), dict):
        raise SystemExit("Invalid inquiry state; manual review required")
    data.setdefault("inquiries", {})
    return data


def save(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def emit(**values: Any) -> None:
    print(json.dumps(values, sort_keys=True))


def require_week(data: dict[str, Any], expected_hash: str, phases: set[str]) -> dict[str, Any]:
    week = data.get("week")
    if not isinstance(week, dict) or week.get("hash") != expected_hash or week.get("phase") not in phases:
        raise SystemExit("Week state/hash mismatch; manual review required")
    return week


def observe_week(args: argparse.Namespace) -> None:
    path = Path(args.state).expanduser()
    data = load(path)
    snapshot = normalize_snapshot(sys.stdin.read())
    if not snapshot or snapshot.startswith("No workout plans found"):
        emit(status="empty")
        return

    current_hash = digest(snapshot)
    marker = f"wgs:{current_hash[:12]}"
    week = data.get("week")
    if not isinstance(week, dict):
        data["week"] = {
            "hash": current_hash, "marker": marker, "phase": "baseline",
            "sheetId": args.sheet_id, "range": args.range, "updatedAt": now(),
        }
        save(path, data)
        emit(status="baseline", hash=current_hash, marker=marker)
        return

    if week.get("hash") == current_hash:
        phase = week.get("phase")
        status = {
            "baseline": "unchanged", "pending": "notify", "notified": "awaiting-confirmation",
            "creating": "needs-review", "created": "unchanged", "failed": "needs-review",
        }.get(phase, "needs-review")
        emit(status=status, hash=current_hash, marker=marker, phase=phase)
        return

    if week.get("phase") == "creating":
        emit(status="needs-review", reason="snapshot-changed-during-creation", hash=current_hash, marker=marker)
        return

    data["week"] = {
        "hash": current_hash, "marker": marker, "phase": "pending",
        "sheetId": args.sheet_id, "range": args.range, "updatedAt": now(),
    }
    save(path, data)
    emit(status="notify", hash=current_hash, marker=marker)


def week_transition(args: argparse.Namespace, source: set[str], target: str) -> None:
    path = Path(args.state).expanduser()
    data = load(path)
    week = require_week(data, args.hash, source)
    week["phase"] = target
    week["updatedAt"] = now()
    if getattr(args, "confirmation_key", None):
        week["confirmationKeyHash"] = digest(args.confirmation_key)
    if getattr(args, "reason", None):
        week["failureReason"] = args.reason
    save(path, data)
    emit(ok=True, phase=target, hash=args.hash)


def claim_week(args: argparse.Namespace) -> None:
    path = Path(args.state).expanduser()
    data = load(path)
    week = data.get("week")
    if isinstance(week, dict) and week.get("hash") == args.hash and week.get("phase") == "creating":
        emit(claimed=False, phase="creating")
        return
    week = require_week(data, args.hash, {"notified"})
    week["phase"] = "creating"
    week["confirmationKeyHash"] = digest(args.confirmation_key)
    week["updatedAt"] = now()
    save(path, data)
    emit(claimed=True, phase="creating", hash=args.hash)


def request_id(key: str) -> str:
    return digest(key)


def claim_day(args: argparse.Namespace) -> None:
    if args.day not in {1, 2, 3, 4}:
        raise SystemExit("Day must be 1, 2, 3, or 4")
    path = Path(args.state).expanduser()
    data = load(path)
    key = request_id(args.request_key)
    existing = data["dayRequests"].get(key)
    if existing:
        emit(claimed=False, phase=existing.get("phase"), day=existing.get("day"))
        return
    data["dayRequests"][key] = {"day": args.day, "phase": "creating", "updatedAt": now()}
    save(path, data)
    emit(claimed=True, phase="creating", day=args.day)


def day_transition(args: argparse.Namespace, target: str) -> None:
    path = Path(args.state).expanduser()
    data = load(path)
    key = request_id(args.request_key)
    request = data["dayRequests"].get(key)
    if not isinstance(request, dict) or request.get("phase") != "creating":
        raise SystemExit("Day request state mismatch; manual review required")
    request["phase"] = target
    request["updatedAt"] = now()
    if getattr(args, "reason", None):
        request["failureReason"] = args.reason
    save(path, data)
    emit(ok=True, phase=target, day=request["day"])


def claim_inquiry(args: argparse.Namespace) -> None:
    path = Path(args.state).expanduser()
    data = load(path)
    key = request_id(args.message_key)
    marker = f"wgs-inquiry:{key[:12]}"
    existing = data["inquiries"].get(key)
    if existing:
        emit(
            claimed=False,
            phase=existing.get("phase"),
            kind=existing.get("kind"),
            marker=existing.get("marker", marker),
        )
        return
    data["inquiries"][key] = {
        "kind": args.kind,
        "marker": marker,
        "phase": "replying",
        "updatedAt": now(),
    }
    save(path, data)
    emit(claimed=True, phase="replying", kind=args.kind, marker=marker)


def inquiry_transition(args: argparse.Namespace, target: str) -> None:
    path = Path(args.state).expanduser()
    data = load(path)
    key = request_id(args.message_key)
    inquiry = data["inquiries"].get(key)
    if not isinstance(inquiry, dict) or inquiry.get("phase") != "replying":
        raise SystemExit("Inquiry state mismatch; manual review required")
    inquiry["phase"] = target
    inquiry["updatedAt"] = now()
    if getattr(args, "reason", None):
        inquiry["failureReason"] = args.reason
    save(path, data)
    emit(ok=True, phase=target, kind=inquiry["kind"], marker=inquiry["marker"])


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)

    observe = commands.add_parser("observe-week")
    observe.add_argument("--state", required=True)
    observe.add_argument("--sheet-id", required=True)
    observe.add_argument("--range", required=True)
    observe.set_defaults(run=observe_week)

    for name, source, target in [
        ("record-week-email", {"pending"}, "notified"),
        ("complete-week", {"creating"}, "created"),
        ("fail-week", {"creating"}, "failed"),
    ]:
        command = commands.add_parser(name)
        command.add_argument("--state", required=True)
        command.add_argument("--hash", required=True)
        if name == "fail-week":
            command.add_argument("--reason", required=True)
        command.set_defaults(run=lambda args, source=source, target=target: week_transition(args, source, target))

    claim = commands.add_parser("claim-week")
    claim.add_argument("--state", required=True)
    claim.add_argument("--hash", required=True)
    claim.add_argument("--confirmation-key", required=True)
    claim.set_defaults(run=claim_week)

    claim_day_parser = commands.add_parser("claim-day")
    claim_day_parser.add_argument("--state", required=True)
    claim_day_parser.add_argument("--request-key", required=True)
    claim_day_parser.add_argument("--day", required=True, type=int)
    claim_day_parser.set_defaults(run=claim_day)

    for name, target in [("complete-day", "created"), ("fail-day", "failed")]:
        command = commands.add_parser(name)
        command.add_argument("--state", required=True)
        command.add_argument("--request-key", required=True)
        if name == "fail-day":
            command.add_argument("--reason", required=True)
        command.set_defaults(run=lambda args, target=target: day_transition(args, target))

    claim_inquiry_parser = commands.add_parser("claim-inquiry")
    claim_inquiry_parser.add_argument("--state", required=True)
    claim_inquiry_parser.add_argument("--message-key", required=True)
    claim_inquiry_parser.add_argument("--kind", required=True, choices=["answer", "clarification"])
    claim_inquiry_parser.set_defaults(run=claim_inquiry)

    for name, target in [("complete-inquiry", "answered"), ("fail-inquiry", "failed")]:
        command = commands.add_parser(name)
        command.add_argument("--state", required=True)
        command.add_argument("--message-key", required=True)
        if name == "fail-inquiry":
            command.add_argument("--reason", required=True)
        command.set_defaults(run=lambda args, target=target: inquiry_transition(args, target))

    return result


if __name__ == "__main__":
    arguments = parser().parse_args()
    state_path = Path(arguments.state).expanduser()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with Path(f"{state_path}.lock").open("a", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        arguments.run(arguments)
