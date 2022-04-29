const core = require('@actions/core');
const { request } = require("@octokit/request");
const { graphql } = require("@octokit/graphql");
const fs = require('fs')

var excludedReposPath = '';
var includedReposPath = '';

async function run() {
    const token = core.getInput("token");
    const orgName = core.getInput("org")
    const rulesPath = core.getInput("rulesPath");
    const action = core.getInput("action");

    excludedReposPath = core.getInput("excludedReposPath");
    includedReposPath = core.getInput("includedReposPath");

    var rulesObj;
    var branches;

    try {
        if (!fs.existsSync(rulesPath)) {
            core.setFailed("Specified branch protection configuration file is missing: " + rulesPath);
        }

        const rules = fs.readFileSync(rulesPath, { encoding: 'utf8', flag: 'r' });
        rulesObj = JSON.parse(rules);
        keys = Object.keys(rulesObj);
        var filtered_repos = await getFinalRepos(token, orgName);


        for (let [repo_name, repo_id] of filtered_repos) {
            protectionRuleIds = await getBranchesProtectionIds(token, orgName, repo_name);

            console.log("Deleting Branch Protection for repo " + repo_name);
            protectionRuleIds.forEach(async (protectionRuleId) => {
                await deleteBranchesProtection(token, protectionRuleId)
            });

            if (action == "set") {
                console.log("Setting Branch Protection for " + branches[j].name + " branch of " + repo_name);

                try {
                    await createBranchProtection(token, repo_id, rulesObj[branches[j].name]);
                } catch (error) {
                    console.error("Branch protection rule creation request failed for repo: " + repo_name, error.message);
                }
            }
        }
    }
    catch (e) {
        core.setFailed(e.stack);
    }
}

async function createBranchProtection(token, repoId, protectionConfig) {

    protectionConfig["repositoryId"] = repoId;

    await graphql({
        query: `mutation createBranchProtection($input: CreateBranchProtectionRuleInput!)  {
            createBranchProtectionRule(input: $input)
            {
                clientMutationId
            }
        }`,
        repo: repoId,
        input: protectionConfig,
        headers: {
            authorization: "token " + token,
        },
    });

}

async function deleteBranchesProtection(token, ruleId) {
    await graphql({
        query: `mutation deleteBranchProtection($branchProtectionRuleId: ID!)  {
            deleteBranchProtectionRule(input: {
                branchProtectionRuleId: $branchProtectionRuleId
            })
            {
                clientMutationId
            }
        }`,
        branchProtectionRuleId: ruleId,
        headers: {
            authorization: "token " + token,
        },
    });
}

async function getBranchesProtectionIds(token, org, repoName) {
    const { repository: { branchProtectionRules: { nodes: id } } } = await graphql({
        query: `query protectedBranches($owner: String!, $repo: String!) {
          repository(owner:$owner, name:$repo) {
            branchProtectionRules(first: 100) {
              nodes {
                id
              }
            }
          }
        }`,
        owner: org,
        repo: repoName,
        headers: {
            authorization: "token " + token,
        },
    });


    return id.map(p => p.id)
}

async function getRepoCount(token, orgName) {
    repoCnt = 0;
    try {
        const result = await request("GET /orgs/{org}/repos", {
            headers: {
                authorization: "token " + token,
            },
            org: orgName,
            per_page: 1,
            type: "all"
        });
        const respUrl = new URL(result.headers.link.split(',')[1].split(';')[0].trim().replace('<', '').replace('>', ''));
        repoCnt = parseInt(respUrl.searchParams.get('page'));
    }
    catch (e) {
        core.setFailed("Exception Occurred in Get Repo Count: " + e.stack);
    }
    return repoCnt;
}

function getPageCount(itemCount, limit) {
    pageCount = (itemCount < limit) ? 1 : (((itemCount % limit) > 0) ? (Math.floor(itemCount / limit) + 1) : (itemCount / limit));
    return pageCount;
}

async function getAllRepos(token, orgName) {
    all_repos = new Map();
    limit = 100;

    repoCount = await getRepoCount(token, orgName);
    pageCnt = getPageCount(repoCount, limit);

    for (let i = 0; i < pageCnt; i++) {
        i = i + 1;
        pagedRepos = await getPagedRepos(token, orgName, i, limit);

        for (let [repo_name, repo_id] of pagedRepos) {
            repoShortName = repo_name.replace(orgName + "/", "");
            all_repos.set(repoShortName, repo_id);
        }
    }

    return all_repos;
}

async function getPagedRepos(token, orgName, pageNum, limit) {
    var repos = new Map();

    try {
        const result = await request("GET /orgs/{org}/repos", {
            headers: {
                authorization: "token " + token,
            },
            org: orgName,
            per_page: limit,
            type: "all",
            page: pageNum
        });
        result.data.forEach(repo => {
            repos.set(repo.name, repo.node_id);
        });
    }
    catch (e) {
        core.setFailed("Exception Occurred in Get Paged Repos: " + e.stack);
    }
    return repos;
}

async function getFinalRepos(token, orgName) {

    var final_repos = new Map();
    var includedRepos = [];

    try {
        all_repos = await getAllRepos(token, orgName);
        includedRepos = getReposFromFile(includedReposPath);

        if (includedRepos.length > 0) {
            final_repos = new Map([...all_repos].filter(([k]) => includedRepos.includes(k)));
            return final_repos;
        }

        excludedRepos = getReposFromFile(excludedReposPath);

        final_repos = new Map([...all_repos].filter(([k]) => !excludedRepos.includes(k)));
    }
    catch (e) {
        core.setFailed("Exception Occurred in Get Paged Repos: " + e.stack);
    }
    return final_repos;
}

function getReposFromFile(repoFilePath) {
    repoArr = [];
    try {
        if (fs.existsSync(repoFilePath)) {
            const reposFrmFile = fs.readFileSync(repoFilePath, { encoding: 'utf8', flag: 'r' });
            if (reposFrmFile != '') {
                reposFrmFile.trim().split(/\r?\n/).forEach(element => {
                    if (element != '') {
                        repoArr.push(element);
                    }
                });
            }
        }
    }
    catch (e) {
        core.setFailed("Exception Occurred in Get Repos From File: " + e.stack);
    }
    return repoArr;
}


run();