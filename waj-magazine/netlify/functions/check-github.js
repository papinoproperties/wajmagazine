// Diagnostic function — delete after troubleshooting
exports.handler = async () => {
  const token = process.env.GITHUB_TOKEN;

  const result = {
    has_token: !!token,
    token_length: token ? token.length : 0,
    token_prefix: token ? token.substring(0, 8) + '...' : 'NOT FOUND',
    starts_with_ghp: token ? token.startsWith('ghp_') : false,
    starts_with_github_pat: token ? token.startsWith('github_pat_') : false,
  };

  if (token) {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'WAJ-Magazine-Diagnostic',
        },
      });
      const data = await res.json();
      result.github_api_status = res.status;
      result.github_response = res.ok
        ? { authenticated_as: data.login }
        : { error: data.message };

      if (res.ok) {
        const repoRes = await fetch(
          'https://api.github.com/repos/papinoproperties/wajmagazine/contents/waj-magazine/content/posts.json',
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'User-Agent': 'WAJ-Magazine-Diagnostic',
            },
          }
        );
        const repoData = await repoRes.json();
        result.repo_file_status = repoRes.status;
        result.repo_file_check = repoRes.ok
          ? { found: true, sha: repoData.sha ? repoData.sha.substring(0,8)+'...' : null }
          : { found: false, error: repoData.message };
      }
    } catch (err) {
      result.github_api_status = 'fetch_failed';
      result.github_error = err.message;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result, null, 2),
  };
};
