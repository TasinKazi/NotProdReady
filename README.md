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

## How it works

```text
Developer
    |
    v
Uploads repository + deployment runbook
    |
    v
NotProdReady API creates an isolated workspace
    |
    v
IBM Bob API activates the $not-prod-ready Skill
    |
    v
Main IBM Bob Agent starts the multi-agent workflow
    |
    v
Runbook Analyst Agent
    |
    |  Output:
    |  Structured Release Claims JSON
    |  - Runtime requirements
    |  - Build and startup commands
    |  - Ports
    |  - Environment variables
    |  - Migration instructions
    |  - Rollback instructions
    |
    v
Repository Inspector Agent
    |
    |  Input:
    |  Release Claims JSON + repository files
    |
    |  Output:
    |  Evidence Comparison JSON
    |  - Documented claim
    |  - Actual repository value
    |  - Evidence source
    |  - File path or command
    |
    v
Main IBM Bob Agent compares claims with evidence
    |
    |  Output:
    |  Candidate PASS, WARN, and BLOCK findings
    |
    v
Release Verifier Agent
    |
    |  Input:
    |  Candidate WARN/BLOCK findings
    |  + targeted evidence paths
    |
    |  Output:
    |  - CONFIRMED
    |  - REJECTED
    |  - INSUFFICIENT EVIDENCE
    |
    v
Main IBM Bob Agent finalizes verified findings
    |
    v
Structured ReleaseResult
    |
    |  - Readiness score
    |  - GO or NO-GO decision
    |  - Confirmed blockers and warnings
    |  - Passed checks
    |  - Supporting evidence
    |  - Recommended actions
    |  - Agent activity
    |
    +----------------------+----------------------+
    |                                             |
    v                                             v
   GO                                           NO-GO
    |                                             |
    v                                             v
Review release evidence                  Review confirmed findings
                                                  |
                                                  v
                                       Ask Bob to remediate
                                                  |
                                                  v
                                      Snapshot isolated repository
                                                  |
                                                  v
                                       Apply targeted corrections
                                                  |
                                                  v
                                      Audit every changed file
                                                  |
                                                  v
                                     Download remediated repository
```

1. A developer uploads an application repository, deployment runbook, application name, release version, and target environment.

2. The NotProdReady backend creates an isolated workspace and sends the release package to the **IBM Bob API**, activating the custom **`$not-prod-ready` Bob-native Skill**.

3. The **Runbook Analyst Agent** reads only the deployment documentation. It extracts the intended release contract and returns structured Release Claims JSON.

4. The Release Claims JSON flows directly to the **Repository Inspector Agent**. This agent examines the repository specifically for evidence related to each documented requirement.

5. The Repository Inspector Agent returns Evidence Comparison JSON showing each runbook claim, the actual repository value, and the exact file, pattern, absence, or command supporting the comparison.

6. The main IBM Bob agent compares the runbook claims with the repository evidence and creates candidate **PASS**, **WARN**, and **BLOCK** findings.

7. Only candidate WARN and BLOCK findings flow to the **Release Verifier Agent**. The verifier receives the proposed findings and their targeted evidence paths instead of repeating the entire analysis.

8. The Release Verifier Agent independently classifies each candidate as **CONFIRMED**, **REJECTED**, or **INSUFFICIENT EVIDENCE**.

9. The verification results flow back to the main IBM Bob agent. Confirmed findings retain their severity, rejected findings become PASS, and findings with insufficient evidence become WARN.

10. The main IBM Bob agent calculates the readiness score and produces the final structured `ReleaseResult` with a **GO** or **NO-GO** decision.

11. For a NO-GO result, the developer can select **Ask Bob to remediate**. IBM Bob applies targeted corrections to an isolated repository copy.

12. NotProdReady audits every created, modified, or deleted file and allows the developer to download the remediated repository. The original repository remains unchanged.
