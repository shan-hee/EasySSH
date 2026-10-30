package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"github.com/easyssh/server/internal/pkg/geoip"
	"github.com/google/uuid"
)

// LoginDetectionService annotates successful owner sessions and sends login alerts.
type LoginDetectionService interface {
	RecordLogin(context.Context, uuid.UUID, *Session, string) error
}

type loginDetectionService struct {
	devices      KnownLoginDeviceRepository
	ownerRepo    Repository
	geoipClient  *geoip.Client
	currentEmail func(context.Context) (EmailService, error)
}

func NewLoginDetectionService(devices KnownLoginDeviceRepository, ownerRepo Repository, geoipClient *geoip.Client, currentEmail func(context.Context) (EmailService, error)) LoginDetectionService {
	return &loginDetectionService{devices: devices, ownerRepo: ownerRepo, geoipClient: geoipClient, currentEmail: currentEmail}
}

// GenerateDeviceFingerprint describes a browser; it cannot establish device identity.
func GenerateDeviceFingerprint(userAgent, acceptLanguage, acceptEncoding string) string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s", userAgent, acceptLanguage, acceptEncoding)))
	return hex.EncodeToString(hash[:])
}

func (s *loginDetectionService) RecordLogin(ctx context.Context, ownerID uuid.UUID, session *Session, fingerprint string) error {
	owner, err := s.ownerRepo.FindByID(ctx, ownerID)
	if err != nil {
		return err
	}
	var location string
	if s.geoipClient != nil && session.IPAddress != "" {
		loc, lookupErr := s.geoipClient.Lookup(ctx, session.IPAddress)
		if lookupErr == nil && loc != nil {
			location = loc.Country
			if loc.City != "" {
				location = fmt.Sprintf("%s, %s, %s", loc.City, loc.Region, loc.Country)
			}
		}
	}
	var existing *KnownLoginDevice
	if fingerprint != "" {
		existing, err = s.devices.FindByOwnerAndFingerprint(ctx, ownerID, fingerprint)
		if err != nil {
			return err
		}
	}
	isNewDevice := fingerprint != "" && existing == nil
	isNewLocation := false
	if location != "" {
		devices, err := s.devices.ListByOwner(ctx, ownerID)
		if err != nil {
			return err
		}
		isNewLocation = len(devices) > 0
		for _, device := range devices {
			if device.LastLocation == location {
				isNewLocation = false
				break
			}
		}
	}
	session.Location, session.IsNewDevice, session.IsNewLocation, session.DeviceFingerprint = location, isNewDevice, isNewLocation, fingerprint
	if fingerprint != "" {
		knownLocation := location
		if existing != nil && location == "" && existing.LastIPAddress == session.IPAddress {
			knownLocation = existing.LastLocation
		}
		err := s.devices.Upsert(ctx, &KnownLoginDevice{
			OwnerID: ownerID, DeviceFingerprint: fingerprint,
			DeviceType: session.DeviceType, DeviceName: session.DeviceName,
			LastIPAddress: session.IPAddress, LastLocation: knownLocation, LastUsed: time.Now().UTC(),
		})
		if err != nil {
			return err
		}
	}
	notifyDevice, notifyLocation := isNewDevice && owner.NotifyNewDevice, isNewLocation && owner.NotifyNewLocation
	if s.currentEmail != nil && (notifyDevice || notifyLocation) {
		// Copy the observation before returning; the login caller persists the session.
		observation := *session
		go s.notify(*owner, observation, notifyDevice, notifyLocation)
	}
	return nil
}

func (s *loginDetectionService) notify(owner Owner, session Session, newDevice, newLocation bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	sender, err := s.currentEmail(ctx)
	if err != nil {
		log.Printf("failed to load login notification configuration: %v", err)
		return
	}
	if sender == nil {
		return
	}
	if newDevice {
		if err := sender.SendNewDeviceAlert(ctx, owner.Email, owner.Username, session.DeviceName, session.IPAddress, session.Location, session.CreatedAt); err != nil {
			log.Printf("failed to send new device alert: %v", err)
		}
	}
	if newLocation {
		if err := sender.SendNewLocationAlert(ctx, owner.Email, owner.Username, session.Location, session.IPAddress, session.CreatedAt); err != nil {
			log.Printf("failed to send new location alert: %v", err)
		}
	}
}
