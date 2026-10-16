// AUTO-GENERATED FILE. Do not edit by hand -- edit template/caddyfileMode.js.erb
// and script/generate.rb in https://github.com/zackwag/caddyfile-codemirror instead.
//
// This is a CodeMirror 6 StreamLanguage mode for the Caddyfile format
// (https://caddyserver.com/docs/caddyfile).
//
// The vocabulary below (directive, option, subdirective and matcher names)
// is extracted directly from the class methods of the Caddyfile lexer in
// the "rouge-lexer-caddyfile" Ruby gem by Sean Whalen (seanthegeek):
//   https://github.com/seanthegeek/rouge-lexer-caddyfile
// That gem is the source of truth for Caddyfile's keyword vocabulary; this
// file is regenerated from it automatically (see .github/workflows/sync.yml)
// so it stays current as Caddy and its plugins evolve, without duplicating
// that research by hand. rouge-lexer-caddyfile is MIT licensed; see LICENSE
// and NOTICE in this repository.
//
// Generated 2026-09-19T17:58:59Z from rouge-lexer-caddyfile v0.2.0.
//
// The state machine below (how a line's first word is classified, how
// blocks/matchers/quotes/heredocs are tracked) is a hand-written, rarely
// changing translation of that gem's Rouge grammar into CodeMirror's
// StreamLanguage token API -- Rouge and CodeMirror have fundamentally
// different token-stream models, so this part can't be mechanically derived
// from the Ruby source the way the vocabulary is.

const DIRECTIVES = new Set(["abort","acme_server","appsec","authenticate","authorize","basic_auth","basicauth","bind","cache","copy_response","copy_response_headers","coraza_waf","crowdsec","encode","error","exec","file_server","filter","forward_auth","fs","handle","handle_errors","handle_path","header","import","intercept","invoke","log","log_append","log_name","log_skip","map","mercure","method","metrics","php_fastcgi","push","rate_limit","redir","replace","request_body","request_header","respond","reverse_proxy","rewrite","root","route","skip_log","templates","tls","trace","tracing","try_files","uri","vars","vulcain","waf","webdav"]);
const GLOBAL_OPTIONS = new Set(["acme_ca","acme_ca_root","acme_dns","acme_eab","admin","auto_https","cache","cert_issuer","cert_lifetime","crowdsec","debug","default_bind","default_sni","dns","dynamic_dns","ech","email","events","exec","fallback_sni","filesystem","grace_period","http_port","https_port","key_type","layer4","local_certs","log","metrics","ocsp_interval","ocsp_stapling","on_demand_tls","order","persist_config","pki","preferred_chains","renew_interval","renewal_window_ratio","security","servers","shutdown_delay","skip_install_trust","storage","storage_clean_interval"]);
const SUBDIRECTIVES = new Set(["0rtt","access_key_id","acl","action","allow","allowed_additional_status_codes","allowed_http_verbs","alpn","alt_http_port","alt_tlsalpn_port","anomaly_threshold","anonymous","any_common_name","api","api_key","api_token","api_url","appsec_fail_open","appsec_max_body_bytes","appsec_max_timeout","appsec_url","args","ask","authentication","authority","authorization","backend","backup_time_format","badger","basepath","block_asns","block_countries","browse","ca","ca_root","cache_keys","cache_name","caller_key","capture_stderr","cdn","cert","check_interval","ciphers","cleanup_interval","client_auth","client_ip_header","client_ip_headers","close","command","comment","compression","configuration","content_type","cookie","cookie_name","cors_origins","crypto","curves","custom_response","dashboard","debug_logging","default","default_cache_control","defer","delete","demo","deny","dial_fallback_delay","dial_timeout","dir","directives","directory","disable","disable_body","disable_canonical_uris","disable_host","disable_http_challenge","disable_method","disable_metrics","disable_query","disable_scheme","disable_streaming","disable_tlsalpn_challenge","disable_vary","dispatch_timeout","distributed","dns","dns_blacklist_file","dns_challenge_override_domain","dns_ttl","domains","duration_format","dynamic","dynamic_domains","eab","early_hints","echo","email","enable","enable_caddy_error","enable_caddy_metrics","enable_full_duplex","enable_hard_fails","enabled","endpoints","enforce_origin","env","err_log","etcd","events","exclude","expect_continue_timeout","fail_duration","fallback_policy","field","fields","file","file_limit","filter","first","flush_interval","folder","force_automate","foreground","format","get_certificate","handle_response","handshake_timeout","hash","header_down","header_up","headers","health_body","health_fails","health_follow_redirects","health_headers","health_interval","health_method","health_passes","health_port","health_request_body","health_status","health_timeout","health_upstream","health_uri","heartbeat","hide","hosted_zone_id","hostname","hostnames","http_redirect","idle","include","index","inject","insecure_secrets_log","insecure_skip_verify","intermediate","intermediate_cn","intermediate_lifetime","interval","ip_blacklist_file","ip_mask","ip_source","ipv4","ipv4_prefix","ipv6","ipv6_prefix","issuer","jitter","keepalive","keepalive_count","keepalive_idle","keepalive_idle_conns","keepalive_idle_conns_per_host","keepalive_interval","key","key_alg","key_id","key_name","keys","lb_policy","lb_retries","lb_retry_match","lb_try_duration","lb_try_interval","level","level_format","level_key","lifetime","line_ending","links","listener_wrappers","load","load_owasp_crs","local","log","log_buffer","log_credentials","log_json","log_key","log_level","log_path","log_severity","mac_key","maintenance_interval","match","match_all_paths","matching_timeout","max_cacheable_body_bytes","max_conns_per_host","max_fails","max_header_size","max_pushes","max_request_body_size","max_response_body_size","max_response_header","max_retries","max_size","message_key","metrics_endpoint","metrics_interval","minimum_length","mode","name","name_key","network","network_proxy","no_hostname","nuts","oauth","observe_catchall_hosts","olric","on","on_demand","openapi_file","origins","otlp","otter","output","override_domain","packet_conn_wrappers","pass_thru","password_recovery_enabled","path","paths","pem","pem_file","per_host","permission","placeholder","postgres_tls","precompressed","prefix","profile","prometheus","prometheus_endpoint","propagation_delay","propagation_timeout","protocol_version_compatibility","protocols","provider","proxy","proxy_protocol","publish_origins","publisher_jwks_url","publisher_jwt","purge_age","query","re","read_body","read_buffer","read_header","read_interval","read_timeout","realm","redact_sensitive_data","redis","regex","regexp","region","rename","renegotiation","renewal_window_ratio","replace","replace_status","replacement","request_buffers","requests","resolve_root_symlink","resolver","resolvers","response_buffers","response_header_timeout","retry_interval","retry_on_failure","reuse_private_keys","reveal_symlinks","roll_at","roll_disabled","roll_interval","roll_keep","roll_keep_for","roll_local_time","roll_minutes","roll_size","roll_uncompressed","root","root_cn","root_common_name","route","route53_max_wait","rule_file","sampling","search_pattern","secret_access_key","server","server_name","service_id","session_token","set","shutdown","sign_with_root","size","skip_route53_sync_on_delete","socks5","soft_start","sort","souin","split","split_path","stacktrace_key","stale","startup","status","storage","storers","strategy","stream","stream_close_delay","stream_timeout","strict_sni_host","subroute","subscriber_jwks_url","subscriber_jwt","subscriber_list_cache_size","subscriptions","sweep_interval","tee","template","test_dir","thereafter","throttle","ticker_interval","time_format","time_key","time_local","timeout","timeouts","tls","tls_client_auth","tls_curves","tls_except_ports","tls_insecure_skip_verify","tls_renegotiation","tls_server_name","tls_timeout","tls_trust_pool","to","topic_selector_cache","tor","tor_ip_blacklist_file","trace","transform","transport","transport_url","trust_der","trust_pool","trusted_proxies","trusted_proxies_strict","trusted_proxies_unix","trusted_roots","try_files","try_policy","ttl","tx_id_req_header","ui","unescape_strings","unhealthy_latency","unhealthy_request_count","unhealthy_status","update_interval","update_only","upstream","url","validate","validity_days","verifier","versions","wait_for_route53_sync","whitelist_countries","whitelist_file","whitelist_ip","window","wrap","write","write_buffer","write_interval","write_timeout","zone","zone_id","zone_token"]);
const MATCHERS = new Set(["client_ip","clock","crowdsec","dns","expression","file","header","header_regexp","host","http","local_ip","method","openvpn","path","path_regexp","postgres","protocol","proxy_protocol","query","quic","rdp","regexp","remote_ip","remote_ip_list","socks4","socks5","ssh","status","tls","vars","vars_regexp","winbox","wireguard","xmpp"]);
const CONSTANTS = new Set(["false","off","on","true"]);
const VALUES = new Set(["DEBUG","DELETE","ERROR","FATAL","GET","HEAD","INFO","OPTIONS","PANIC","POST","PUT","WARN","acme","after","akamai","append","argon2id","asc","bcrypt","before","br","bypass","bypass_request","bypass_response","cloudflare","console","cookie","debug","delete","desc","disable_certs","disable_redirects","discard","duckdns","ed25519","error","fastly","file","file_system","filter","first","first_exist","first_exist_fallback","folder","freely","grpc","gzip","h1","h2","h2c","h3","hard","hash","http","http_redirect","https","ignore","ignore_loaded_certs","info","inline","insecure_off","interface","internal","ip_mask","ipv4","ipv6","json","largest_size","last","leaf","local","most_recently_modified","name","namedirfirst","net","never","none","once","p256","p384","pem","pem_file","pki_intermediate","pki_root","private_ranges","proxy_protocol","query","re","regexp","reject","rename","replace","request","require","require_and_verify","rfc2136","route53","rsa2048","rsa4096","simple_http","size","skip","smallest","smallest_size","soft","souin","static","stderr","stdout","storage","stream","strict","tailscale","time","tls","tls1.2","tls1.3","transform","upnp","url","use","v1","v2","verify_if_given","warn","zerossl","zstd"]);

const ENV_VAR = /^\{\$[^\s{}"`]+\}/;
const PLACEHOLDER = /^\{[A-Za-z_%?][^\s{}"`]*\}/;
const OPEN_BLOCK = /^\{[ \t]*(?:#.*)?$/;
const SNIPPET_NAME = /^&?\([^\s()]+\)/;
const MATCHER_LABEL = /^@[^\s{}"`#,]+/;
const HEREDOC_START = /^<<([A-Za-z0-9_-]+)$/;
const WORD = /^[^\s{}"`#@,][^\s{}"`,]*/;
const ARG = /^[^\s{"`,][^\s{"`,]*/;
const BOUNDARY_END = /(?=[\s,{}]|$)/;
const ADDRESS_LIKE = /[.:/*]/;

function isAddress(word) {
    return ADDRESS_LIKE.test(word) || word === "localhost";
}

function classifyArgWord(word) {
    if (CONSTANTS.has(word)) return "atom";
    if (VALUES.has(word)) return "typeName";
    return null;
}

function classifyRootWord(word) {
    if (word === "match") return { style: "property", mode: "margs" };
    if (DIRECTIVES.has(word)) return { style: "keyword", mode: "args", ref: word === "import" || word === "invoke" };
    if (SUBDIRECTIVES.has(word)) return { style: "property", mode: "args" };
    if (GLOBAL_OPTIONS.has(word)) return { style: "keyword", mode: "args" };
    if (isAddress(word)) return { style: "variable", mode: "address" };
    return { style: null, mode: "args" };
}

function classifyGlobalWord(word) {
    if (GLOBAL_OPTIONS.has(word)) return { style: "keyword", mode: "gargs" };
    if (SUBDIRECTIVES.has(word)) return { style: "property", mode: "gargs" };
    if (isAddress(word)) return { style: "variable", mode: "gargs" };
    return { style: null, mode: "gargs" };
}

function classifyMatcherWord(word) {
    if (word === "not") return { style: "keyword", mode: "margs" };
    if (MATCHERS.has(word)) return { style: "builtin", mode: "margs" };
    if (SUBDIRECTIVES.has(word)) return { style: "property", mode: "margs" };
    return { style: null, mode: "margs" };
}

function topContext(state) {
    return state.stack[state.stack.length - 1];
}

function startOfLine(stream, state) {
    if (state.continuation) {
        state.continuation = false;
        return;
    }
    if (state.mode !== "dq" && state.mode !== "bt" && state.mode !== "heredoc") {
        state.mode = "line";
    }
}

function readQuoted(stream, state) {
    if (state.mode === "dq") {
        if (stream.match(/^\\\\/)) return "string";
        if (stream.match(/^\\"/)) return "string";
        if (stream.eat("\\")) return "string";
        if (stream.match(/^[^"\\]+/)) return "string";
        if (stream.eat('"')) { state.mode = state.quoteReturn; return "string"; }
    } else {
        if (stream.match(/^[^`]+/)) return "string";
        if (stream.eat("`")) { state.mode = state.quoteReturn; return "string"; }
    }
    stream.next();
    return "string";
}

function readHeredoc(stream, state) {
    const marker = state.heredocMarker;
    const closeRe = new RegExp(`^[ \\t]*${marker}(?=\\s|$)`);
    if (stream.match(closeRe)) {
        state.mode = state.heredocReturn;
        return "string";
    }
    stream.skipToEnd();
    return "string";
}

// Rules shared by args / gargs / margs (the "rest of line" states).
function readArgCommon(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match(OPEN_BLOCK)) {
        // Nested block: args (root context) doesn't push -- a directive's own
        // block reuses root's vocabulary. gargs/margs push a fresh frame of
        // their own context so the matching close brace pops the right depth.
        if (state.mode === "gargs") state.stack.push("global");
        else if (state.mode === "margs") state.stack.push("matcher");
        state.mode = "line";
        return null;
    }
    if (stream.match(/^\\$/)) { state.continuation = true; return null; }
    if (stream.match(/^#.*/)) return "comment";
    if (stream.eat(",")) return null;
    if (stream.eat('"')) { state.quoteReturn = state.mode; state.mode = "dq"; return "string"; }
    if (stream.eat("`")) { state.quoteReturn = state.mode; state.mode = "bt"; return "string"; }
    let m = stream.match(HEREDOC_START);
    if (m) {
        state.heredocMarker = m[1];
        state.heredocReturn = state.mode;
        state.mode = "heredoc";
        return "string";
    }
    if (stream.match(/^\\\{/)) return null;
    if (stream.match(ENV_VAR)) return "variable-2";
    if (stream.match(PLACEHOLDER)) return "variable-2";
    if (stream.match(MATCHER_LABEL)) return "variable";
    if (stream.match(/^\*(?=[\s,]|$)/)) return "operator";
    if (stream.match(/^[!+\-?>](?=[A-Za-z])/)) return "operator";
    if (stream.match(/^=(?=\d)/)) return "operator";
    if (stream.match(new RegExp("^\\d+\\.\\d+" + BOUNDARY_END.source))) return "number";
    if (stream.match(new RegExp("^\\d+(?:\\.\\d+)?[a-zA-Z]+" + BOUNDARY_END.source))) return "number";
    if (stream.match(new RegExp("^\\d+" + BOUNDARY_END.source))) return "number";
    return undefined;
}

export const caddyfile = {
    startState() {
        return { stack: ["root"], mode: "line", continuation: false, pendingRef: false, quoteReturn: null, heredocMarker: null, heredocReturn: null };
    },

    copyState(state) {
        return {
            stack: state.stack.slice(),
            mode: state.mode,
            continuation: state.continuation,
            pendingRef: state.pendingRef,
            quoteReturn: state.quoteReturn,
            heredocMarker: state.heredocMarker,
            heredocReturn: state.heredocReturn,
        };
    },

    token(stream, state) {
        if (stream.sol()) startOfLine(stream, state);

        if (state.mode === "dq" || state.mode === "bt") return readQuoted(stream, state);
        if (state.mode === "heredoc") return readHeredoc(stream, state);

        if (state.mode === "line") {
            if (stream.eatSpace()) return null;
            if (stream.match(/^#.*/)) return "comment";

            const ctx = topContext(state);

            if (stream.eat("}")) {
                if (ctx === "global" || ctx === "matcher") state.stack.pop();
                return null;
            }
            if (stream.match(OPEN_BLOCK)) {
                state.stack.push(ctx === "matcher" ? "matcher" : "global");
                return null;
            }

            if (ctx === "root") {
                if (stream.match(SNIPPET_NAME)) { state.mode = "args"; return "def"; }
                if (stream.match(MATCHER_LABEL)) { state.mode = "margs"; return "variable"; }
                if (stream.match(ENV_VAR)) { state.mode = "address"; return "variable-2"; }
                if (stream.match(PLACEHOLDER)) { state.mode = "args"; return "variable-2"; }
                if (stream.eat('"')) { state.quoteReturn = "args"; state.mode = "dq"; return "string"; }
                if (stream.eat("`")) { state.quoteReturn = "args"; state.mode = "bt"; return "string"; }
                const m = stream.match(WORD);
                if (m) {
                    const { style, mode, ref } = classifyRootWord(m[0]);
                    state.mode = mode;
                    state.pendingRef = !!ref;
                    return style;
                }
                stream.next();
                return null;
            }

            if (ctx === "global") {
                if (stream.match(MATCHER_LABEL)) { state.mode = "margs"; return "variable"; }
                if (stream.match(ENV_VAR)) { state.mode = "gargs"; return "variable-2"; }
                if (stream.match(PLACEHOLDER)) { state.mode = "gargs"; return "variable-2"; }
                if (stream.eat('"')) { state.quoteReturn = "gargs"; state.mode = "dq"; return "string"; }
                if (stream.eat("`")) { state.quoteReturn = "gargs"; state.mode = "bt"; return "string"; }
                const m = stream.match(WORD);
                if (m) {
                    const { style, mode } = classifyGlobalWord(m[0]);
                    state.mode = mode;
                    return style;
                }
                stream.next();
                return null;
            }

            // ctx === "matcher"
            if (stream.match(ENV_VAR)) { state.mode = "margs"; return "variable-2"; }
            if (stream.match(PLACEHOLDER)) { state.mode = "margs"; return "variable-2"; }
            if (stream.eat('"')) { state.quoteReturn = "margs"; state.mode = "dq"; return "string"; }
            if (stream.eat("`")) { state.quoteReturn = "margs"; state.mode = "bt"; return "string"; }
            const m = stream.match(WORD);
            if (m) {
                const { style, mode } = classifyMatcherWord(m[0]);
                state.mode = mode;
                return style;
            }
            stream.next();
            return null;
        }

        // Rest-of-line states: args / gargs / margs / address
        if (state.mode === "address") {
            if (stream.eatSpace()) return null;
            if (stream.match(/^#.*/)) return "comment";
            if (stream.match(OPEN_BLOCK)) { state.mode = "line"; return null; }
            if (stream.eat(",")) return null;
            if (stream.match(ENV_VAR)) return "variable-2";
            if (stream.eat('"')) { state.quoteReturn = "address"; state.mode = "dq"; return "string"; }
            if (stream.eat("`")) { state.quoteReturn = "address"; state.mode = "bt"; return "string"; }
            if (stream.match(/^[^\s{}"`#,]+/)) return "variable";
            stream.next();
            return null;
        }

        // args / gargs / margs
        const common = readArgCommon(stream, state);
        if (common !== undefined) return common;

        if (state.mode === "margs") {
            const m = stream.match(ARG);
            if (m) {
                const word = m[0];
                state.pendingRef = false;
                if (word === "not") return "keyword";
                if (MATCHERS.has(word)) return "builtin";
                return classifyArgWord(word);
            }
        } else {
            const m = stream.match(ARG);
            if (m) {
                const wasRef = state.pendingRef;
                state.pendingRef = false;
                if (wasRef) return "def";
                return classifyArgWord(m[0]);
            }
        }

        if (stream.match(/^[{}]/)) return null;
        stream.next();
        return null;
    },
};
