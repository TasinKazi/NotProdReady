![NotProdReady Banner](./docs/assets/notprodready-banner.png)

# NOTPRODREADY

**Release readiness before production.**

Built for the **IBM Dev Day Hackathon (August 2026 / Developer Productivity with IBM Bob 2.0).**

[Watch the 3-minute demo](ADD_NOTPRODREADY_VIDEO_LINK_HERE) · [Try the live demo](https://notprodready.onrender.com/) · [Judge's Quick Guide](./JUDGE.md)

---

## Problem

Production deployment failures often begin with a dangerous assumption: that the deployment documentation still describes the application being released.

According to [IBM’s Bendigo and Adelaide Bank case study](https://www.ibm.com/case-studies/bendigo-adelaide-bank), the bank experienced process bloat, extensive manual intervention, and difficulty delivering applications quickly enough to meet customer expectations. New application environments typically required 5 weeks to deliver, while thousands of spreadsheets were used to manage processes across the organization.

[IBM also reports that Daimler Trucks North America relied on a manual deployment document containing more than 30 steps](https://www.ibm.com/case-studies/daimler-trucks-north-america). Deployments required 60–90 minutes, there was no clear automated rollback path, and limited source-control traceability increased the possibility of deployment errors.

The same underlying risk exists whenever deployment documentation and application reality drift apart. A runbook may require one runtime version while the repository requires another. A production startup command may no longer exist. Required environment variables may be undocumented. Database migrations may have no corresponding rollback procedure, or the documented rollback instructions may be incompatible with the application being released.

These inconsistencies can remain invisible during development because traditional tests, linters, and security scanners evaluate the codebase but typically do not verify whether the repository, deployment runbook, and declared production requirements agree with one another.

As a result, teams may enter deployment with a checklist that appears complete but is factually incorrect. The consequences can include failed releases, production downtime, emergency patches, delayed recovery, lost engineering time, and avoidable customer impact.

The challenge is not simply finding problems in source code. It is proving, before deployment begins, that the operational instructions and the software being released describe the same production reality.

## Solution

**NotProdReady** is an IBM Bob-native release-readiness platform that transforms a deployment runbook and repository archive into an auditable production-readiness decision. Its custom Bob-native Skill coordinates a multi-agent workflow that compares documented deployment requirements with repository evidence and returns a structured **GO** or **NO-GO** decision containing a readiness score, confirmed findings, supporting evidence, and recommended actions.

For a NO-GO result, the user can ask IBM Bob to remediate confirmed findings within an isolated copy of the repository, review the audited file changes, download the remediated version, and run a new independent analysis. NotProdReady replaces a manual, trust-based checklist with an evidence-driven IBM Bob workflow that helps engineering teams identify production risk before production does.
