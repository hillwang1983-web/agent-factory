#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def main():
    adus = load(ROOT / ".ai-agent" / "registry" / "adu.json")["adus"]
    runs = load(ROOT / ".ai-agent" / "registry" / "runs.json")["runs"]
    print("ADU STATUS")
    print("----------")
    for adu in adus:
        print(f"{adu['id']} | state={adu['state']} | retry={adu['retry_count']} | human_gate={adu['human_gate_required']}")
        if adu.get("artifacts"):
            print("  artifacts:")
            for item in adu["artifacts"]:
                print(f"  - {item}")
    print("")
    print("LAST RUNS")
    print("---------")
    for run in runs[-5:]:
        print(f"{run['timestamp']} | {run['adu_id']} | {run['agent']} | {run['result']} | {run['run_dir']}")


if __name__ == "__main__":
    main()
