use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Cross-platform Python executable name.
fn python_exe() -> &'static str {
    if cfg!(windows) { "python" } else { "python3" }
}

/// Cross-platform temp directory (replaces hard-coded "/tmp").
fn tmp_dir() -> std::path::PathBuf {
    std::env::temp_dir()
}
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;
use tokio::io::{AsyncBufReadExt, BufReader};

// ── Data model ────────────────────────────────────────────────────────────────

// Serializes as 0..4 to match frontend's StageIndex
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(transparent)]
pub struct PipelineStage(pub u8);

impl PipelineStage {
    pub const FETCH: Self = Self(0);
    pub const TRANSCRIBE: Self = Self(1);
    pub const TRANSLATE: Self = Self(2);
    pub const REVIEW: Self = Self(3);
    pub const PUBLISH: Self = Self(4);
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Processing,
    Ready,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub duration: Option<String>,
    pub thumbnail_url: Option<String>,
    pub stage: PipelineStage,
    pub status: JobStatus,
    pub added_at: String,
    pub elapsed_secs: Option<u64>,
    pub status_note: Option<String>,   // human-readable progress message
    pub error_note: Option<String>,
    pub video_path: Option<String>,    // local path when video is downloaded
    pub video_download_pct: Option<u8>, // 0-100 while downloading, None = not started
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSegment {
    pub id: i32,
    pub in_time: f64,
    pub out_time: f64,
    pub en: String,
    pub zh: String,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiliCredentials {
    pub uid: String,
    pub sessdata: String,
    pub bili_jct: String,
    pub username: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub download_dir: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        let dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(tmp_dir)
            .join("TubePilot")
            .to_string_lossy()
            .to_string();
        AppSettings { download_dir: dir }
    }
}

#[derive(Debug, Default)]
pub struct AppState {
    pub jobs: Mutex<HashMap<String, Job>>,
    pub subtitles: Mutex<HashMap<String, Vec<SubtitleSegment>>>,
    pub bili_creds: Mutex<Option<BiliCredentials>>,
    pub settings: Mutex<AppSettings>,
}

// ── Bilibili helpers ──────────────────────────────────────────────────────────

fn bili_creds_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| tmp_dir())
        .join("bili_credentials.json")
}

fn save_bili_creds(creds: &BiliCredentials, app: &AppHandle) {
    let path = bili_creds_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(creds) {
        let _ = std::fs::write(path, json);
    }
}

/// Simple percent-decode (handles %XX and + → space).
fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte as char);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { ' ' } else { b[i] as char });
        i += 1;
    }
    out
}

fn extract_query_param(url_str: &str, key: &str) -> Option<String> {
    let query = url_str.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == key { Some(url_decode(v)) } else { None }
    })
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn submit_job(url: String, state: State<AppState>, app: AppHandle) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let job = Job {
        id: id.clone(),
        url: url.clone(),
        title: None,
        channel: None,
        duration: None,
        thumbnail_url: None,
        stage: PipelineStage::FETCH,
        status: JobStatus::Processing,
        added_at: Utc::now().to_rfc3339(),
        elapsed_secs: Some(0),
        status_note: Some("正在获取视频信息...".to_string()),
        error_note: None,
        video_path: None,
        video_download_pct: None,
    };

    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        jobs.insert(id.clone(), job.clone());
    }

    app.emit("job:updated", &job).map_err(|e: tauri::Error| e.to_string())?;

    let id_clone = id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        run_pipeline(id_clone, url, app_clone).await;
    });

    Ok(id)
}

#[tauri::command]
fn get_jobs(state: State<AppState>) -> Result<Vec<Job>, String> {
    let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let mut list: Vec<Job> = jobs.values().cloned().collect();
    // Most recent first
    list.sort_by(|a, b| b.added_at.cmp(&a.added_at));
    Ok(list)
}

#[tauri::command]
fn get_job(id: String, state: State<AppState>) -> Result<Option<Job>, String> {
    let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    Ok(jobs.get(&id).cloned())
}

#[tauri::command]
fn cancel_job(id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if let Some(job) = jobs.get_mut(&id) {
        if job.status == JobStatus::Processing {
            job.status = JobStatus::Cancelled;
            app.emit("job:updated", job.clone()).ok();
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_job(id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        // Only allow deleting finished jobs (not actively processing)
        if let Some(job) = jobs.get(&id) {
            if job.status == JobStatus::Processing {
                return Err("Cannot delete a job that is still processing".to_string());
            }
        }
        jobs.remove(&id);
    }
    state.subtitles.lock().map_err(|e| e.to_string())?.remove(&id);
    app.emit("job:deleted", &id).ok();
    Ok(())
}

#[tauri::command]
fn retry_job(id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let url;
    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs.get_mut(&id).ok_or("job not found")?;
        job.status = JobStatus::Processing;
        job.stage = PipelineStage::FETCH;
        job.error_note = None;
        job.status_note = Some("正在获取视频信息...".to_string());
        job.elapsed_secs = Some(0);
        url = job.url.clone();
        app.emit("job:updated", job.clone()).ok();
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        run_pipeline(id, url, app_clone).await;
    });

    Ok(())
}

#[tauri::command]
fn get_subtitles(job_id: String, state: State<AppState>) -> Result<Vec<SubtitleSegment>, String> {
    let subtitles = state.subtitles.lock().map_err(|e| e.to_string())?;
    Ok(subtitles.get(&job_id).cloned().unwrap_or_default())
}

#[tauri::command]
fn update_subtitle(
    job_id: String,
    seg_id: i32,
    zh: String,
    state: State<AppState>,
) -> Result<(), String> {
    let mut subtitles = state.subtitles.lock().map_err(|e| e.to_string())?;
    let segs = subtitles.get_mut(&job_id).ok_or("subtitles not found")?;
    if let Some(seg) = segs.iter_mut().find(|s| s.id == seg_id) {
        seg.zh = zh;
        seg.approved = false;
    }
    Ok(())
}

#[tauri::command]
fn approve_subtitle(
    job_id: String,
    seg_id: i32,
    approved: bool,
    state: State<AppState>,
) -> Result<(), String> {
    let mut subtitles = state.subtitles.lock().map_err(|e| e.to_string())?;
    let segs = subtitles.get_mut(&job_id).ok_or("subtitles not found")?;
    if let Some(seg) = segs.iter_mut().find(|s| s.id == seg_id) {
        seg.approved = approved;
    }
    Ok(())
}

// ── Bilibili commands ─────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiliQrcodeInfo {
    qrcode_key: String,
    qr_svg: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiliPollResult {
    status: String,  // "waiting" | "scanned" | "confirmed" | "expired"
    user: Option<BiliCredentials>,
}

#[tauri::command]
fn get_bilibili_user(state: State<AppState>) -> Result<Option<BiliCredentials>, String> {
    Ok(state.bili_creds.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
async fn bilibili_qrcode_generate() -> Result<BiliQrcodeInfo, String> {
    use qrcode::QrCode;
    use qrcode::render::svg;

    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
        .send().await.map_err(|e| format!("网络错误：{e}"))?
        .json().await.map_err(|e| format!("解析响应失败：{e}"))?;

    let data = resp.get("data").ok_or("API 响应格式异常")?;
    let url = data["url"].as_str().ok_or("缺少 url 字段")?.to_string();
    let qrcode_key = data["qrcode_key"].as_str().ok_or("缺少 qrcode_key 字段")?.to_string();

    let code = QrCode::new(url.as_bytes()).map_err(|e| format!("二维码生成失败：{e}"))?;
    let qr_svg = code
        .render::<svg::Color<'_>>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .build();

    Ok(BiliQrcodeInfo { qrcode_key, qr_svg })
}

#[tauri::command]
async fn bilibili_qrcode_poll(
    qrcode_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<BiliPollResult, String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/poll")
        .query(&[("qrcode_key", &qrcode_key)])
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
        .send().await.map_err(|e| format!("网络错误：{e}"))?
        .json().await.map_err(|e| format!("解析响应失败：{e}"))?;

    let data = resp.get("data").ok_or("API 响应格式异常")?;
    let code = data["code"].as_i64().unwrap_or(-1);

    match code {
        86101 => Ok(BiliPollResult { status: "waiting".into(), user: None }),
        86090 => Ok(BiliPollResult { status: "scanned".into(), user: None }),
        86038 => Ok(BiliPollResult { status: "expired".into(), user: None }),
        0 => {
            let redirect = data["url"].as_str().ok_or("登录响应缺少 url 字段")?;
            let sessdata = extract_query_param(redirect, "SESSDATA").ok_or("缺少 SESSDATA")?;
            let bili_jct = extract_query_param(redirect, "bili_jct").ok_or("缺少 bili_jct")?;
            let uid      = extract_query_param(redirect, "DedeUserID").ok_or("缺少 DedeUserID")?;

            // Fetch display name + avatar
            let nav: serde_json::Value = match client
                .get("https://api.bilibili.com/x/web-interface/nav")
                .header("Cookie", format!("SESSDATA={sessdata}; bili_jct={bili_jct}; DedeUserID={uid}"))
                .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
                .send().await
            {
                Ok(r) => r.json().await.unwrap_or(serde_json::Value::Null),
                Err(_) => serde_json::Value::Null,
            };

            let nd = nav.get("data").unwrap_or(&serde_json::Value::Null);
            let username   = nd["uname"].as_str().unwrap_or("未知用户").to_string();
            let avatar_url = nd["face"].as_str().unwrap_or("").to_string();

            let creds = BiliCredentials { uid, sessdata, bili_jct, username, avatar_url };
            save_bili_creds(&creds, &app);
            *state.bili_creds.lock().map_err(|e| e.to_string())? = Some(creds.clone());

            Ok(BiliPollResult { status: "confirmed".into(), user: Some(creds) })
        }
        other => Err(format!("B站返回未知状态码：{other}")),
    }
}

#[tauri::command]
fn bilibili_logout(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    *state.bili_creds.lock().map_err(|e| e.to_string())? = None;
    let path = bili_creds_path(&app);
    let _ = std::fs::remove_file(path);
    Ok(())
}

#[tauri::command]
fn publish_job(job_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    let job = jobs.get_mut(&job_id).ok_or("job not found")?;
    job.stage = PipelineStage::PUBLISH;
    job.status = JobStatus::Done;
    job.status_note = None;
    job.error_note = None;
    app.emit("job:updated", job.clone()).ok();
    Ok(())
}

// ── Settings commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    settings: AppSettings,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    *s = settings.clone();
    persist_settings(&settings, &app);
    Ok(())
}

#[tauri::command]
async fn select_download_dir(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_can_create_directories(true)
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

#[tauri::command]
async fn start_publish_job(
    job_id: String,
    title: String,
    desc: String,
    tid: u32,
    tags: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // Require Bilibili login
    let creds = state.bili_creds.lock().map_err(|e| e.to_string())?
        .clone()
        .ok_or("未登录B站，请先在设置页扫码登录")?;

    // Grab job URL, thumbnail, and pre-downloaded video path
    let (job_url, thumbnail_url, video_path) = {
        let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs.get(&job_id).ok_or("job not found")?;
        (job.url.clone(), job.thumbnail_url.clone(), job.video_path.clone())
    };
    let subtitles = state.subtitles.lock().map_err(|e| e.to_string())?
        .get(&job_id).cloned().unwrap_or_default();

    // Build meta JSON (video_path if already downloaded, else sidecar will download)
    let meta = serde_json::json!({
        "url":        job_url,
        "video_path": video_path,          // null → sidecar downloads; path → skip download
        "title":      title,
        "desc":       desc,
        "tid":        tid,
        "tags":       tags,
        "cover_url":  thumbnail_url.unwrap_or_default(),
        "sessdata":   creds.sessdata,
        "bili_jct":   creds.bili_jct,
        "uid":        creds.uid,
        "subtitles":  subtitles,
    });

    // Write meta to temp file
    let meta_path = std::env::temp_dir()
        .join("tubepilot")
        .join(format!("{job_id}-publish-meta.json"));
    if let Some(p) = meta_path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&meta_path, serde_json::to_string(&meta).unwrap())
        .map_err(|e| e.to_string())?;

    // Set job to Publishing / Processing
    {
        let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs.get_mut(&job_id).ok_or("job not found")?;
        job.stage = PipelineStage::PUBLISH;
        job.status = JobStatus::Processing;
        job.status_note = Some("正在下载视频...".to_string());
        job.error_note = None;
        app.emit("job:updated", job.clone()).ok();
    }

    let meta_path_str = meta_path.to_string_lossy().to_string();
    let job_id_clone = job_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        match run_sidecar(
            &["publish", &job_id_clone, &meta_path_str],
            &job_id_clone,
            &app_clone,
        ).await {
            Ok(result) => {
                let bvid = result["bvid"].as_str().unwrap_or("").to_string();
                let app_state = app_clone.state::<AppState>();
                let mut jobs = app_state.jobs.lock().unwrap();
                if let Some(job) = jobs.get_mut(&job_id_clone) {
                    job.status = JobStatus::Done;
                    job.status_note = if bvid.is_empty() {
                        Some("已发布到B站".to_string())
                    } else {
                        Some(format!("已发布 {bvid}"))
                    };
                    app_clone.emit("job:updated", job.clone()).ok();
                }
            }
            Err(e) => set_job_error(&job_id_clone, e, &app_clone),
        }
    });

    Ok(())
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async fn run_pipeline(job_id: String, url: String, app: AppHandle) {
    // Stage 0: Fetch metadata
    let meta = match sidecar_fetch_metadata(&url).await {
        Ok(m) => m,
        Err(e) => {
            set_job_error(&job_id, e, &app);
            return;
        }
    };

    {
        let state = app.state::<AppState>();
        let mut jobs = state.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            if job.status == JobStatus::Cancelled { return; }
            job.title = Some(meta.title);
            job.channel = Some(meta.channel);
            job.duration = Some(meta.duration);
            job.thumbnail_url = meta.thumbnail_url;
            app.emit("job:updated", job.clone()).ok();
        }
    }

    // Start video download concurrently with transcription
    {
        let dl_job_id  = job_id.clone();
        let dl_url     = url.clone();
        let dl_app     = app.clone();
        let dl_dir     = app.state::<AppState>().settings.lock().unwrap().download_dir.clone();
        tokio::spawn(async move {
            sidecar_download(&dl_job_id, &dl_url, &dl_dir, &dl_app).await;
        });
    }

    // Stage 1: Transcribe (or fetch YouTube subtitles)
    set_job_stage(&job_id, PipelineStage::TRANSCRIBE, &app);
    if is_cancelled(&job_id, &app) { return; }

    let (raw_segments, zh_available) = match sidecar_transcribe(&job_id, &url, &app).await {
        Ok(t) => t,
        Err(e) => { set_job_error(&job_id, e, &app); return; }
    };

    // Stage 2: Translate — skip if YouTube already provided zh captions
    let final_segments = if zh_available {
        match serde_json::from_value::<Vec<SubtitleSegment>>(
            serde_json::Value::Array(raw_segments)
        ) {
            Ok(s) => s,
            Err(e) => { set_job_error(&job_id, format!("Segment parse error: {e}"), &app); return; }
        }
    } else {
        set_job_stage(&job_id, PipelineStage::TRANSLATE, &app);
        if is_cancelled(&job_id, &app) { return; }
        match rust_translate_segments(&job_id, raw_segments, &app).await {
            Ok(s) => s,
            Err(e) => { set_job_error(&job_id, e, &app); return; }
        }
    };

    // Store subtitles and move to Review
    {
        let state = app.state::<AppState>();
        state.subtitles.lock().unwrap().insert(job_id.clone(), final_segments);
        let mut jobs = state.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            if job.status == JobStatus::Cancelled { return; }
            job.stage = PipelineStage::REVIEW;
            job.status = JobStatus::Ready;
            app.emit("job:updated", job.clone()).ok();
        }
    }
}

// ── Pipeline helpers ──────────────────────────────────────────────────────────

fn set_job_stage(job_id: &str, stage: PipelineStage, app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut jobs = state.jobs.lock().unwrap();
    if let Some(job) = jobs.get_mut(job_id) {
        job.stage = stage;
        job.status = JobStatus::Processing;
        app.emit("job:updated", job.clone()).ok();
    }
}

fn set_job_error(job_id: &str, msg: String, app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut jobs = state.jobs.lock().unwrap();
    if let Some(job) = jobs.get_mut(job_id) {
        job.status = JobStatus::Error;
        job.error_note = Some(msg);
        app.emit("job:updated", job.clone()).ok();
    }
}

fn set_job_note(job_id: &str, note: &str, app: &AppHandle) {
    if note.is_empty() { return; }
    let state = app.state::<AppState>();
    let mut jobs = state.jobs.lock().unwrap();
    if let Some(job) = jobs.get_mut(job_id) {
        job.status_note = Some(note.to_string());
        app.emit("job:updated", job.clone()).ok();
    }
}

fn is_cancelled(job_id: &str, app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let jobs = state.jobs.lock().unwrap();
    jobs.get(job_id)
        .map(|j| j.status == JobStatus::Cancelled)
        .unwrap_or(true)
}

// Maps (stage, step) from Python progress JSON → Chinese status message
fn progress_note(stage: &str, step: &str) -> &'static str {
    match (stage, step) {
        ("transcribe", "fetch_info")       => "正在获取视频信息...",
        ("transcribe", "check_zh")         => "正在获取字幕...",
        ("transcribe", "check_en")         => "正在获取英文字幕...",
        ("transcribe", "downloading_en")   => "正在下载英文字幕...",
        ("transcribe", "whisper_fallback") => "未找到字幕，准备语音转录...",
        ("transcribe", "whisper_load")     => "正在加载语音识别模型...",
        ("transcribe", "whisper_run")      => "转录中，请稍候（可能需要几分钟）...",
        ("transcribe", "done")             => "字幕获取完成",
        ("translate",  "batch")            => "正在翻译字幕...",
        ("translate",  "done")             => "翻译完成",
        ("publish",    "download_video")   => "正在下载视频...",
        ("publish",    "translating_meta")  => "正在翻译标题和简介...",
        ("publish",    "upload_video")     => "准备上传到B站...",
        ("publish",    "uploading_chunks") => "正在上传视频...",
        ("publish",    "submitting")       => "正在提交...",
        ("publish",    "done")             => "发布成功",
        _                                  => "",
    }
}

// Runs a sidecar command, streams stdout line-by-line:
//   - progress JSON  → calls set_job_note (also tracks last step for error context)
//   - last JSON line → returned as Result<Value>
// On failure: reads stderr and formats a human-readable message including the failed step.
async fn run_sidecar(
    args: &[&str],
    job_id: &str,
    app: &AppHandle,
) -> Result<serde_json::Value, String> {
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;

    let mut env = load_dot_env();
    // Auto-detect TRANSLATE_PROVIDER from available credentials
    if !env.contains_key("TRANSLATE_PROVIDER") {
        if env.contains_key("TENCENT_SECRET_ID") && env.contains_key("TENCENT_SECRET_KEY") {
            env.insert("TRANSLATE_PROVIDER".to_string(), "tencent".to_string());
        } else if env.contains_key("BING_TRANSLATE_KEY") {
            env.insert("TRANSLATE_PROVIDER".to_string(), "bing".to_string());
        }
    }

    let mut child = tokio::process::Command::new(python_exe())
        .arg(sidecar_path())
        .args(args)
        .envs(&env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动处理程序：{e}"))?;

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    // Read stderr concurrently so it never blocks
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut r = BufReader::new(stderr);
        let _ = r.read_to_string(&mut buf).await;
        buf
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut last_result: Option<serde_json::Value> = None;
    let mut last_step = String::new(); // last human-readable step, for error context

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if val.get("type").and_then(|t| t.as_str()) == Some("progress") {
                let stage = val["stage"].as_str().unwrap_or("");
                let step  = val["step"].as_str().unwrap_or("");
                let note  = progress_note(stage, step);
                if !note.is_empty() {
                    last_step = note.trim_end_matches("...").to_string();
                    set_job_note(job_id, note, app);
                }
            } else {
                last_result = Some(val);
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_out = stderr_task.await.unwrap_or_default();

    if !status.success() {
        // Try to extract the Python error message from stderr JSON
        let python_msg = stderr_out
            .lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter_map(|v| v["message"].as_str().map(|s| s.to_string()))
            .last()
            .unwrap_or_else(|| stderr_out.trim().to_string());

        let step_ctx = if last_step.is_empty() {
            String::new()
        } else {
            format!("【{}】", last_step)
        };

        return Err(if python_msg.is_empty() {
            format!("{}处理失败（exit {}）", step_ctx, status)
        } else {
            format!("{}失败：{}", step_ctx, python_msg)
        });
    }

    last_result.ok_or_else(|| "处理程序未返回结果".to_string())
}

// ── Translation (Rust-native, no Python) ─────────────────────────────────────

use std::sync::OnceLock;
use tokio::sync::Semaphore;

fn sha256_hex(data: &[u8]) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(data))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC key error");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

// Rate limiter: max 4 concurrent Tencent requests, each slot released after 1 s
static TENCENT_SEM: OnceLock<std::sync::Arc<Semaphore>> = OnceLock::new();
fn tencent_sem() -> std::sync::Arc<Semaphore> {
    TENCENT_SEM.get_or_init(|| std::sync::Arc::new(Semaphore::new(4))).clone()
}

async fn tencent_translate_one(text: &str, secret_id: &str, secret_key: &str) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let service  = "tmt";
    let host     = "tmt.tencentcloudapi.com";
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let date = chrono::DateTime::from_timestamp(timestamp as i64, 0)
        .unwrap_or_default().format("%Y-%m-%d").to_string();

    let payload = serde_json::json!({
        "SourceText": text, "Source": "en", "Target": "zh", "ProjectId": 0
    }).to_string();

    // TC3-HMAC-SHA256 signing
    let hashed_payload = sha256_hex(payload.as_bytes());
    let canonical_headers = format!("content-type:application/json; charset=utf-8\nhost:{host}\n");
    let canonical_request = format!(
        "POST\n/\n\n{canonical_headers}\ncontent-type;host\n{hashed_payload}"
    );
    let credential_scope = format!("{date}/{service}/tc3_request");
    let string_to_sign = format!(
        "TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );

    let key_date    = hmac_sha256(format!("TC3{secret_key}").as_bytes(), date.as_bytes());
    let key_service = hmac_sha256(&key_date,    service.as_bytes());
    let key_signing = hmac_sha256(&key_service, b"tc3_request");
    let signature   = hex::encode(hmac_sha256(&key_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "TC3-HMAC-SHA256 Credential={secret_id}/{credential_scope}, \
         SignedHeaders=content-type;host, Signature={signature}"
    );

    let resp: serde_json::Value = reqwest::Client::new()
        .post(format!("https://{host}/"))
        .header("Authorization", &authorization)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Host", host)
        .header("X-TC-Action", "TextTranslate")
        .header("X-TC-Version", "2018-03-21")
        .header("X-TC-Region", "ap-guangzhou")
        .header("X-TC-Timestamp", timestamp.to_string())
        .body(payload)
        .send().await.map_err(|e| format!("Tencent HTTP error: {e}"))?
        .json().await.map_err(|e| format!("Tencent JSON parse error: {e}"))?;

    resp["Response"]["TargetText"].as_str()
        .ok_or_else(|| format!("Tencent API error: {:?}", resp["Response"]["Error"]))
        .map(|s| s.to_string())
}

async fn tencent_translate_all(
    texts: &[String],
    secret_id: &str,
    secret_key: &str,
    job_id: &str,
    app: &AppHandle,
) -> Result<Vec<String>, String> {
    use tokio::task::JoinSet;

    let total = texts.len();
    let sem   = tencent_sem();
    let mut set: JoinSet<(usize, Result<String, String>)> = JoinSet::new();

    for (i, text) in texts.iter().enumerate() {
        let text  = text.clone();
        let sid   = secret_id.to_string();
        let skey  = secret_key.to_string();
        let sem   = sem.clone();

        set.spawn(async move {
            // Acquire rate-limit slot, release after 1 s
            let permit = sem.acquire_owned().await.expect("semaphore closed");
            let result = tencent_translate_one(&text, &sid, &skey).await;
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                drop(permit);
            });
            (i, result)
        });
    }

    let mut results  = vec![String::new(); total];
    let mut done     = 0usize;
    while let Some(res) = set.join_next().await {
        let (idx, translated) = res.map_err(|e| e.to_string())?;
        results[idx] = translated.map_err(|e| format!("翻译第 {idx} 条失败：{e}"))?;
        done += 1;
        if done % 20 == 0 || done == total {
            set_job_note(job_id, &format!("正在翻译字幕...({done}/{total})"), app);
        }
    }
    Ok(results)
}

async fn bing_translate_batch(texts: &[String], key: &str) -> Result<Vec<String>, String> {
    let body: Vec<_> = texts.iter().map(|t| serde_json::json!({"Text": t})).collect();
    let resp: serde_json::Value = reqwest::Client::new()
        .post("https://api.cognitive.microsofttranslator.com/translate")
        .query(&[("api-version", "3.0"), ("from", "en"), ("to", "zh-Hans")])
        .header("Ocp-Apim-Subscription-Key", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| format!("Bing HTTP error: {e}"))?
        .json().await.map_err(|e| format!("Bing JSON parse error: {e}"))?;

    resp.as_array()
        .ok_or("Bing returned non-array")?
        .iter()
        .map(|r| {
            r["translations"][0]["text"].as_str()
                .ok_or("Missing translation text".to_string())
                .map(|s| s.to_string())
        })
        .collect()
}

async fn bing_translate_all(
    texts: &[String],
    key: &str,
    job_id: &str,
    app: &AppHandle,
) -> Result<Vec<String>, String> {
    use tokio::task::JoinSet;
    const BATCH: usize = 100;

    let batches: Vec<(usize, Vec<String>)> = texts
        .chunks(BATCH)
        .enumerate()
        .map(|(i, c)| (i, c.to_vec()))
        .collect();
    let total_batches = batches.len();
    let key = key.to_string();

    let mut set: JoinSet<(usize, Result<Vec<String>, String>)> = JoinSet::new();
    for (i, batch) in batches {
        let key = key.clone();
        set.spawn(async move { (i, bing_translate_batch(&batch, &key).await) });
    }

    let mut results: Vec<Option<Vec<String>>> = vec![None; total_batches];
    let total_segs = texts.len();
    while let Some(res) = set.join_next().await {
        let (idx, batch_result) = res.map_err(|e| e.to_string())?;
        results[idx] = Some(batch_result?);
        let translated_so_far: usize = results.iter().flatten().map(|v| v.len()).sum();
        set_job_note(job_id, &format!("正在翻译字幕...({translated_so_far}/{total_segs})"), app);
    }

    Ok(results.into_iter().flatten().flatten().collect())
}

/// Replaces sidecar_translate — runs entirely in Rust.
async fn rust_translate_segments(
    job_id: &str,
    raw_segs: Vec<serde_json::Value>,
    app: &AppHandle,
) -> Result<Vec<SubtitleSegment>, String> {
    let env      = load_dot_env();
    let provider = detect_translate_provider(&env)?;
    let texts: Vec<String> = raw_segs.iter()
        .map(|s| s["en"].as_str().unwrap_or("").to_string())
        .collect();

    let translated = match provider.as_str() {
        "bing" => {
            let key = env.get("BING_TRANSLATE_KEY").ok_or("BING_TRANSLATE_KEY not set")?;
            bing_translate_all(&texts, key, job_id, app).await?
        }
        "tencent" => {
            let sid  = env.get("TENCENT_SECRET_ID").ok_or("TENCENT_SECRET_ID not set")?;
            let skey = env.get("TENCENT_SECRET_KEY").ok_or("TENCENT_SECRET_KEY not set")?;
            tencent_translate_all(&texts, sid, skey, job_id, app).await?
        }
        _ => return Err(format!("Unknown TRANSLATE_PROVIDER: {provider}")),
    };

    raw_segs.iter().zip(translated.iter())
        .map(|(seg, zh)| {
            let mut s: SubtitleSegment = serde_json::from_value(seg.clone())
                .map_err(|e| format!("Segment parse error: {e}"))?;
            s.zh = zh.clone();
            Ok(s)
        })
        .collect()
}

fn detect_translate_provider(env: &HashMap<String, String>) -> Result<String, String> {
    if let Some(p) = env.get("TRANSLATE_PROVIDER") {
        return Ok(p.clone());
    }
    if env.contains_key("TENCENT_SECRET_ID") && env.contains_key("TENCENT_SECRET_KEY") {
        return Ok("tencent".to_string());
    }
    if env.contains_key("BING_TRANSLATE_KEY") {
        return Ok("bing".to_string());
    }
    Err("翻译服务未配置：请在 .env.local 设置 BING_TRANSLATE_KEY 或 TENCENT_SECRET_ID/KEY".to_string())
}

// ── Sidecar calls ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct VideoMetadata {
    title: String,
    channel: String,
    duration: String,
    thumbnail_url: Option<String>,
}

// Calls: python3 sidecar/main.py fetch-metadata <url>
async fn sidecar_fetch_metadata(url: &str) -> Result<VideoMetadata, String> {
    let output = tokio::process::Command::new(python_exe())
        .arg(sidecar_path())
        .arg("fetch-metadata")
        .arg(url)
        .output()
        .await
        .map_err(|e| format!("无法启动处理程序：{e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try to parse Python's JSON error: {"type":"error","message":"..."}
        let msg = stderr.lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .filter_map(|v| v["message"].as_str().map(|s| s.to_string()))
            .last()
            .unwrap_or_else(|| stderr.trim().to_string());
        return Err(format!("【获取视频信息】失败：{}", msg));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<VideoMetadata>(stdout.trim())
        .map_err(|e| format!("解析视频信息失败：{e}"))
}

// Streams sidecar/main.py transcribe, updates status_note in real-time.
// Returns (segments, zh_available).
async fn sidecar_transcribe(
    job_id: &str,
    url: &str,
    app: &AppHandle,
) -> Result<(Vec<serde_json::Value>, bool), String> {
    let result = run_sidecar(&["transcribe", job_id, url], job_id, app).await?;
    let zh_available = result["zh_available"].as_bool().unwrap_or(false);
    let segments = result["segments"]
        .as_array()
        .cloned()
        .ok_or_else(|| "Missing 'segments' in transcribe output".to_string())?;
    Ok((segments, zh_available))
}

// Streams sidecar/main.py translate, updates status_note in real-time.
// Writes segments to a temp file to avoid OS argument-length limits.
// ── Settings helpers ──────────────────────────────────────────────────────────

fn settings_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| tmp_dir())
        .join("settings.json")
}

fn load_settings_from_disk(app: &AppHandle) -> AppSettings {
    let path = settings_path(app);
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<AppSettings>(&data) {
            return s;
        }
    }
    AppSettings::default()
}

fn persist_settings(settings: &AppSettings, app: &AppHandle) {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(settings) {
        let _ = std::fs::write(path, json);
    }
}

// ── Video download sidecar ────────────────────────────────────────────────────

// Calls: python3 sidecar/main.py download <job_id> <url> <output_dir>
// Background-only: updates video_download_pct and video_path in job state.
async fn sidecar_download(job_id: &str, url: &str, output_dir: &str, app: &AppHandle) {
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;

    let env = load_dot_env();
    let mut child = match tokio::process::Command::new(python_exe())
        .arg(sidecar_path())
        .args(["download", job_id, url, output_dir])
        .envs(&env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => { eprintln!("sidecar_download spawn error: {e}"); return; }
    };

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let _stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf).await;
    });

    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            let state = app.state::<AppState>();
            if val.get("type").and_then(|t| t.as_str()) == Some("progress") {
                let pct = val["percent"].as_u64().unwrap_or(0) as u8;
                let mut jobs = state.jobs.lock().unwrap();
                if let Some(job) = jobs.get_mut(job_id) {
                    job.video_download_pct = Some(pct);
                    app.emit("job:updated", job.clone()).ok();
                }
            } else if let Some(path) = val["video_path"].as_str() {
                let mut jobs = state.jobs.lock().unwrap();
                if let Some(job) = jobs.get_mut(job_id) {
                    job.video_path = Some(path.to_string());
                    job.video_download_pct = Some(100);
                    app.emit("job:updated", job.clone()).ok();
                }
            }
        }
    }
    let _ = child.wait().await;
}

fn sidecar_path() -> std::path::PathBuf {
    // tauri dev: CARGO_MANIFEST_DIR is set to the src-tauri directory
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = std::path::Path::new(&manifest_dir).join("sidecar").join("main.py");
        if p.exists() { return p; }
    }
    // Launched directly (open ./target/debug/tubepilot):
    // exe = …/src-tauri/target/debug/tubepilot  →  ../../../sidecar/main.py
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            let p = bin_dir
                .parent() // target
                .and_then(|d| d.parent()) // src-tauri
                .map(|d| d.join("sidecar").join("main.py"));
            if let Some(p) = p { if p.exists() { return p; } }
        }
    }
    std::path::PathBuf::from("sidecar/main.py")
}

// Parse .env.local from the project root and return key=value pairs.
// Supports: KEY=VALUE, KEY="VALUE", # comments, blank lines.
fn load_dot_env() -> HashMap<String, String> {
    let candidates: &[fn() -> Option<std::path::PathBuf>] = &[
        // dev: CARGO_MANIFEST_DIR = …/apps/desktop/src-tauri  →  root = ../../../
        || std::env::var("CARGO_MANIFEST_DIR").ok().map(|d| {
            std::path::Path::new(&d).join("../../../.env.local").canonicalize().ok()
                .unwrap_or_else(|| std::path::Path::new(&d).join("../../../.env.local"))
        }),
        // direct binary: …/src-tauri/target/debug/tubepilot  →  root = ../../../../../../
        || std::env::current_exe().ok().and_then(|e| {
            // go up: debug → target → src-tauri → desktop → apps → TubePilot
            let mut p = e.parent()?.to_path_buf();
            for _ in 0..5 { p = p.parent()?.to_path_buf(); }
            Some(p.join(".env.local"))
        }),
    ];

    for candidate_fn in candidates {
        if let Some(path) = candidate_fn() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let mut map = HashMap::new();
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') { continue; }
                    if let Some((k, v)) = line.split_once('=') {
                        let v = v.trim().trim_matches('"').trim_matches('\'');
                        map.insert(k.trim().to_string(), v.to_string());
                    }
                }
                if !map.is_empty() { return map; }
            }
        }
    }
    HashMap::new()
}

// ── App setup ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let state = app.state::<AppState>();
            // Load persisted Bilibili credentials
            let creds_path = app.path().app_data_dir()
                .unwrap_or_else(|_| tmp_dir())
                .join("bili_credentials.json");
            if let Ok(data) = std::fs::read_to_string(&creds_path) {
                if let Ok(creds) = serde_json::from_str::<BiliCredentials>(&data) {
                    *state.bili_creds.lock().unwrap() = Some(creds);
                }
            }
            // Load persisted settings
            let settings = load_settings_from_disk(&app.handle().clone());
            *state.settings.lock().unwrap() = settings;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            submit_job,
            get_jobs,
            get_job,
            cancel_job,
            delete_job,
            retry_job,
            get_subtitles,
            update_subtitle,
            approve_subtitle,
            publish_job,
            get_bilibili_user,
            bilibili_qrcode_generate,
            bilibili_qrcode_poll,
            bilibili_logout,
            start_publish_job,
            get_settings,
            save_settings,
            select_download_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
