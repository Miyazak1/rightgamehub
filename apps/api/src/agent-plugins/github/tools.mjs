import {GITHUB_CODE_TOOL,createGitHubCodeAdapter,validateGitHubCodeInput,validateGitHubCodeOutput} from '../../agent-github-code-tool.mjs';
import {GITHUB_REPOSITORY_SEARCH_TOOL,createGitHubRepositorySearchAdapter,validateGitHubRepositorySearchInput,validateGitHubRepositorySearchOutput} from '../../agent-github-repository-search-tool.mjs';
import {GITHUB_REPOSITORY_READ_TOOL,createGitHubRepositoryReadAdapter,validateGitHubRepositoryReadInput,validateGitHubRepositoryReadOutput} from '../../agent-github-repository-tool.mjs';
import {GITHUB_REPOSITORY_MATERIALS_TOOL,createGitHubRepositoryMaterialsAdapter,validateGitHubRepositoryMaterialsInput,validateGitHubRepositoryMaterialsOutput} from '../../agent-github-repository-materials-tool.mjs';

export const githubToolContracts=Object.freeze([GITHUB_CODE_TOOL,GITHUB_REPOSITORY_SEARCH_TOOL,GITHUB_REPOSITORY_READ_TOOL,GITHUB_REPOSITORY_MATERIALS_TOOL]);
export function createGitHubToolConfiguration({githubToken=null,fetchImpl=fetch}={}){
 return {
  adapters:{'research.github.code.read@1':createGitHubCodeAdapter({token:githubToken,fetchImpl}),'research.github.repository.search@1':createGitHubRepositorySearchAdapter({token:githubToken,fetchImpl}),'research.github.repository.read@1':createGitHubRepositoryReadAdapter({token:githubToken,fetchImpl}),'research.github.repository.materials.read@1':createGitHubRepositoryMaterialsAdapter({token:githubToken,fetchImpl})},
  inputSchemas:{'github.code.input@1':validateGitHubCodeInput,'github.repository.search.input@1':validateGitHubRepositorySearchInput,'github.repository.read.input@1':validateGitHubRepositoryReadInput,'github.repository.materials.read.input@1':validateGitHubRepositoryMaterialsInput},
  outputSchemas:{'github.code.output@1':validateGitHubCodeOutput,'github.repository.search.output@1':validateGitHubRepositorySearchOutput,'github.repository.read.output@1':validateGitHubRepositoryReadOutput,'github.repository.materials.read.output@1':validateGitHubRepositoryMaterialsOutput},
 };
}
