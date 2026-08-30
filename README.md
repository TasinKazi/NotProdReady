![NotProdReady Banner](./docs/assets/notprodready-banner.png)

# NOTPRODREADY

**Release readiness before production.**

Built for the **IBM Dev Day Hackathon (August 2026 / Developer Productivity with IBM Bob 2.0).**

[Watch the 3-minute demo](https://www.youtube.com/) · [Try the live demo](https://notprodready.onrender.com/) · [Judge's Quick Guide](./JUDGE.md)

---

## Problem

According to [IBM’s Bendigo and Adelaide Bank case study](https://www.ibm.com/case-studies/bendigo-adelaide-bank), the bank experienced process bloat, extensive manual intervention, and difficulty delivering applications quickly enough to meet customer expectations. New application environments typically required 5 weeks to deliver, while thousands of spreadsheets were used to manage processes across the organization.

[IBM also reports that Daimler Trucks North America relied on a manual deployment document containing more than 30 steps](https://www.ibm.com/case-studies/daimler-trucks-north-america). Deployments required 60–90 minutes, there was no clear automated rollback path, and limited source-control traceability increased the possibility of deployment errors.

A deployment runbook may require one runtime version while the repository requires another. A production startup command may no longer exist. Environment variables may be undocumented, migration procedures may be incomplete, or rollback instructions may not match the application being released. The challenge is not simply finding issues in source code; it is determining whether the repository, deployment documentation, and actual production requirements agree with each other. 

## Solution

**NotProdReady** is an IBM Bob-native release-readiness platform that transforms a deployment runbook and repository archive into an auditable production-readiness decision. Its custom Bob-native Skill coordinates a multi-agent workflow that compares documented deployment requirements with repository evidence and returns a structured **GO** or **NO-GO** decision containing a readiness score, confirmed findings, supporting evidence, and recommended actions.

For a NO-GO result, the user can ask IBM Bob to remediate confirmed findings within an isolated copy of the repository, review the audited file changes, download the remediated version, and run a new independent analysis. NotProdReady replaces a manual, trust-based checklist with an evidence-driven IBM Bob workflow that helps engineering teams identify production risk before production does.
