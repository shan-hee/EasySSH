package chatbridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/easyssh/shared/aiprovider"
)

const feishuTextBytes = 64 << 10

var feishuResourceID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,256}$`)

type feishuResource struct {
	messageID, key, kind, name string
}

type feishuMedia struct {
	parentID  string
	resources []feishuResource
	bindingID string
	images    []aiprovider.Attachment
	excerpts  []string
	err       error
}

type feishuPostNode struct {
	Tag      string `json:"tag"`
	Text     string `json:"text"`
	ImageKey string `json:"image_key"`
}

type feishuPost struct {
	Title   string             `json:"title"`
	Content [][]feishuPostNode `json:"content"`
}

func feishuContent(kind, raw, messageID string) (string, []feishuResource, error) {
	var content struct {
		feishuPost
		Text     string `json:"text"`
		ImageKey string `json:"image_key"`
		FileKey  string `json:"file_key"`
		FileName string `json:"file_name"`
	}
	if kind != "text" && kind != "image" && kind != "file" && kind != "post" {
		return "", nil, nil
	}
	if err := json.Unmarshal([]byte(raw), &content); err != nil {
		return "", nil, errors.New("飞书消息内容格式无效。")
	}
	switch kind {
	case "text":
		return content.Text, nil, nil
	case "image":
		return "", []feishuResource{{messageID, content.ImageKey, kind, "图片"}}, nil
	case "file":
		return "", []feishuResource{{messageID, content.FileKey, kind, content.FileName}}, nil
	}
	post := content.feishuPost
	if post.Content == nil {
		var locales map[string]feishuPost
		if json.Unmarshal([]byte(raw), &locales) == nil {
			post = locales["zh_cn"]
			if post.Content == nil {
				for _, translation := range locales {
					if translation.Content != nil {
						post = translation
						break
					}
				}
			}
		}
	}
	lines := []string{post.Title}
	var resources []feishuResource
	for _, row := range post.Content {
		var line strings.Builder
		for _, node := range row {
			switch node.Tag {
			case "text", "a", "md", "code_block":
				line.WriteString(node.Text)
			case "img":
				resources = append(resources, feishuResource{messageID, node.ImageKey, "image", "图片"})
			}
		}
		lines = append(lines, line.String())
	}
	return strings.TrimSpace(strings.Join(lines, "\n")), resources, nil
}

func (s *Service) feishuQuotedResources(ctx context.Context, token, chatID, parentID string) ([]feishuResource, error) {
	var result struct {
		Data struct {
			Items []struct {
				ID      string                   `json:"message_id"`
				ChatID  string                   `json:"chat_id"`
				Kind    string                   `json:"msg_type"`
				Deleted bool                     `json:"deleted"`
				Body    struct{ Content string } `json:"body"`
			} `json:"items"`
		} `json:"data"`
	}
	if feishuResourceID.MatchString(parentID) {
		if err := s.feishuRequest(ctx, http.MethodGet, "/im/v1/messages/"+parentID, token, nil, &result); err == nil {
			for _, item := range result.Data.Items {
				if item.ID == parentID && item.ChatID == chatID && !item.Deleted {
					_, resources, err := feishuContent(item.Kind, item.Body.Content, item.ID)
					return resources, err
				}
			}
		}
	}
	return nil, errors.New("无法读取引用消息。请检查应用的消息读取权限，或将附件直接发给机器人。")
}

func (s *Service) feishuDownload(ctx context.Context, token string, resource feishuResource, limit int) ([]byte, error) {
	if !feishuResourceID.MatchString(resource.messageID) || !feishuResourceID.MatchString(resource.key) || (resource.kind != "image" && resource.kind != "file") {
		return nil, errors.New("飞书附件标识无效，请重新发送。")
	}
	endpoint := feishuAPI + "/im/v1/messages/" + resource.messageID + "/resources/" + resource.key + "?type=" + resource.kind
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, errors.New("无法创建附件请求。")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, errors.New("附件下载失败，请检查网络后重试。")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("飞书未返回附件（HTTP %d），请检查消息读取权限及文件是否可下载。", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)+1))
	if err != nil || len(data) == 0 {
		return nil, errors.New("附件为空或下载中断。")
	}
	if resp.Header.Get("Content-Disposition") == "" && strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
		var problem struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if json.Unmarshal(data, &problem) == nil && problem.Code != 0 && problem.Msg != "" {
			return nil, fmt.Errorf("飞书拒绝下载附件（错误码 %d），请检查消息读取权限。", problem.Code)
		}
	}
	return data, nil
}

func feishuTextExcerpt(name string, data []byte) (string, error) {
	truncated := len(data) > feishuTextBytes
	if truncated {
		data = data[:feishuTextBytes]
		start := len(data) - 1
		for start > len(data)-utf8.UTFMax && !utf8.RuneStart(data[start]) {
			start--
		}
		if !utf8.FullRune(data[start:]) {
			data = data[:start]
		}
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return "", errors.New("该文件不是 UTF-8 纯文本，请转换编码后重发。")
	}
	header := fmt.Sprintf("附件 %q", truncate(name, 160))
	if truncated {
		header += "（已截断，仅前 64 KiB）"
	}
	return header + "：\n" + string(data), nil
}

func (s *Service) loadFeishuMedia(ctx context.Context, conn Connection, chatID string, media *feishuMedia) error {
	token, err := s.feishuToken(ctx, conn)
	if err != nil {
		return errors.New("无法取得飞书凭据，请检查连接配置。")
	}
	resources := media.resources
	if media.parentID != "" {
		quoted, err := s.feishuQuotedResources(ctx, token, chatID, media.parentID)
		if err != nil {
			return err
		}
		resources = append(resources, quoted...)
	}
	imageCount, remaining := 0, aiprovider.MaxImageTotalBytes
	for _, resource := range resources {
		image := resource.kind == "image"
		if !image {
			switch strings.ToLower(path.Ext(resource.name)) {
			case ".png", ".jpg", ".jpeg", ".gif", ".webp":
				image = true
			case ".txt", ".log", ".md", ".json", ".jsonl", ".yaml", ".yml", ".csv", ".xml", ".ini", ".conf":
			default:
				return errors.New("暂不支持此文件类型，请发送图片或 UTF-8 文本文件（如 .log、.txt、.csv）。")
			}
		}
		limit := feishuTextBytes
		if image {
			imageCount++
			if imageCount > aiprovider.MaxImageAttachments {
				return fmt.Errorf("每条消息最多支持 %d 张图片。", aiprovider.MaxImageAttachments)
			}
			limit = min(aiprovider.MaxImageBytes, remaining)
		}
		data, err := s.feishuDownload(ctx, token, resource, limit)
		if err != nil {
			return err
		}
		if !image {
			excerpt, err := feishuTextExcerpt(resource.name, data)
			if err != nil {
				return err
			}
			media.excerpts = append(media.excerpts, excerpt)
			continue
		}
		if len(data) > limit {
			return fmt.Errorf("图片过大：单张最多 %d MiB，合计最多 %d MiB。", aiprovider.MaxImageBytes>>20, aiprovider.MaxImageTotalBytes>>20)
		}
		mime := http.DetectContentType(data)
		switch mime {
		case "image/jpeg", "image/png", "image/webp", "image/gif":
		default:
			return errors.New("无法识别图片，请发送 PNG、JPEG、WebP 或 GIF。")
		}
		remaining -= len(data)
		media.images = append(media.images, aiprovider.Attachment{ID: stableID(resource.messageID + ":" + resource.key), Name: truncate(resource.name, 160), MediaType: mime, Data: base64.StdEncoding.EncodeToString(data), Size: int64(len(data))})
	}
	return nil
}
