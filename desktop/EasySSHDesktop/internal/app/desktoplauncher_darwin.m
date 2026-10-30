#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

extern void easySSHLauncherReady(void);
extern void easySSHLauncherOpenURL(char *value);

@interface EasySSHLauncherDelegate : NSObject <NSApplicationDelegate>
@end

@implementation EasySSHLauncherDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    easySSHLauncherReady();
}
- (void)handleURL:(NSAppleEventDescriptor *)event reply:(NSAppleEventDescriptor *)reply {
    NSString *value = [[event paramDescriptorForKeyword:keyDirectObject] stringValue];
    if (value && [value length] <= 4096) {
        easySSHLauncherOpenURL((char *)[value UTF8String]);
    }
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)visible {
    easySSHLauncherOpenURL("");
    return NO;
}
@end

void easySSHLauncherRun(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyProhibited];
        EasySSHLauncherDelegate *delegate = [[EasySSHLauncherDelegate alloc] init];
        [app setDelegate:delegate];
        NSAppleEventManager *events = [NSAppleEventManager sharedAppleEventManager];
        [events setEventHandler:delegate andSelector:@selector(handleURL:reply:)
                 forEventClass:kInternetEventClass andEventID:kAEGetURL];
        [app run];
        [events removeEventHandlerForEventClass:kInternetEventClass andEventID:kAEGetURL];
        [app setDelegate:nil];
        [delegate release];
    }
}

void easySSHLauncherStop(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp stop:nil];
        NSEvent *event = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                           location:NSZeroPoint modifierFlags:0 timestamp:0
                           windowNumber:0 context:nil subtype:0 data1:0 data2:0];
        [NSApp postEvent:event atStart:NO];
    });
}
