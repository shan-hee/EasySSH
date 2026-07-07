package textencoding

import (
	"bytes"
	"io"
	"strings"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/transform"
)

func EncodingForName(name string) encoding.Encoding {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "gbk", "gb2312":
		return simplifiedchinese.GBK
	case "gb18030":
		return simplifiedchinese.GB18030
	case "big5":
		return traditionalchinese.Big5
	case "shift_jis", "shift-jis", "sjis":
		return japanese.ShiftJIS
	case "euc-jp":
		return japanese.EUCJP
	case "euc-kr":
		return korean.EUCKR
	default:
		return nil
	}
}

func Decode(content string, encodingName string) string {
	decoder := EncodingForName(encodingName)
	if decoder == nil {
		return content
	}

	decoded, err := io.ReadAll(transform.NewReader(bytes.NewReader([]byte(content)), decoder.NewDecoder()))
	if err != nil {
		return content
	}
	return string(decoded)
}
